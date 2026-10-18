"""Session host (ADR-0036): one live ipykernel for one notebook.

Rust starts it where workers run and writes one NotebookKernelRequest per line on stdin. It
answers execute with a NotebookExecution line and variables with a NotebookVariables line on
stdout; interrupt and shutdown get no answer. Interrupt is read while a cell runs.

Run as `python -m sprisk_code.session --cell-seconds 600 --memory-mb 4096`."""

import ast
import json
import queue
import re
import shutil
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Any

import psutil
import typer
from jupyter_client.blocking.client import BlockingKernelClient
from jupyter_client.kernelspec import KernelSpec, KernelSpecManager
from jupyter_client.manager import KernelManager
from jupyter_client.provisioning.local_provisioner import LocalProvisioner
from pydantic import ValidationError

from sprisk_code.kernel_display import MIME
from sprisk_code.shown import MAX_FIGURE_BYTES, MAX_FIGURES, MAX_ITEMS, MAX_TEXT_CHARS, cut
from sprisk_contracts import NotebookExecution, NotebookKernelRequest, NotebookVariables
from sprisk_contracts.generated.models import DisplayItem, KernelExecute, KernelVariables

STARTUP_SECONDS = 60
POLL_SECONDS = 0.25
# After an interrupt, how long the kernel has to stop before it is restarted.
GRACE_SECONDS = 5
STARTUP = (
    "from sprisk_code.kernel_display import install as _sprisk_install\n"
    "_sprisk_install(get_ipython())\n"
    "del _sprisk_install"
)
# Module and class of a name, e.g. pandas.DataFrame. Names are port names (contract), so they
# cannot carry code.
TYPE_OF = "type({0}).__module__.split('.')[0] + '.' + type({0}).__qualname__"
TABLE_TYPES = {"pandas.DataFrame", "polars.DataFrame"}
SHUTDOWN = NotebookKernelRequest.model_validate_json('{"op": "shutdown"}')
ANSI = re.compile(r"\x1b\[[0-9;]*m")
# The last lines of a traceback say where it failed; the first are the cell's own frames.
MAX_TRACEBACK_LINES = 100
MAX_TRACEBACK_LINE_CHARS = 1000


@dataclass(frozen=True)
class Limits:
    cell_seconds: float
    memory_mb: int


class KernelError(Exception):
    """The kernel could not start or stopped answering."""


class Outputs:
    """A cell's iopub messages as display items, in order and capped like a code step's."""

    def __init__(self) -> None:
        self.items: list[dict[str, Any]] = []
        self.error: dict[str, Any] | None = None
        self.execution_count: int | None = None
        self.figures = 0

    def add(self, msg: dict[str, Any]) -> None:
        kind, content = msg["msg_type"], msg["content"]
        if kind == "stream":
            self._text(content["text"], content["name"])
        elif kind in ("execute_result", "display_data"):
            item = _item(content["data"])
            if item is not None and item["kind"] in ("figure", "image"):
                self._figure(item)
            elif item is not None:
                self._add(item)
        elif kind == "execute_input":
            self.execution_count = content["execution_count"]
        elif kind == "error":
            lines = content["traceback"][-MAX_TRACEBACK_LINES:]
            self.error = {
                "name": cut(content["ename"], MAX_TRACEBACK_LINE_CHARS),
                "message": cut(content["evalue"], MAX_TEXT_CHARS),
                "traceback": [cut(ANSI.sub("", line), MAX_TRACEBACK_LINE_CHARS) for line in lines],
            }
        elif kind == "clear_output":
            self.items.clear()

    def _figure(self, item: dict[str, Any]) -> None:
        self.figures += 1
        if self.figures <= MAX_FIGURES:
            self._add(item)
        elif self.figures == MAX_FIGURES + 1:
            note = f"More than {MAX_FIGURES} figures; the rest are not shown."
            self._add({"kind": "text", "text": note})

    def _add(self, item: dict[str, Any]) -> None:
        """Every item is checked: the cell's own code can emit any display bundle."""
        if len(self.items) >= MAX_ITEMS:
            return
        text = json.dumps(item)
        try:
            DisplayItem.model_validate_json(text)
        except ValidationError:
            item = {"kind": "text", "text": "An output could not be shown: it is not a display."}
        size = len(text)
        if size > MAX_FIGURE_BYTES:
            item = {"kind": "text", "text": f"An output of {size} bytes is too large to show."}
        self.items.append(item)

    def _text(self, chunk: str, channel: str) -> None:
        last = self.items[-1] if self.items else None
        if last is not None and last.get("channel") == channel:
            last["text"] = cut(last["text"] + chunk, MAX_TEXT_CHARS)
        else:
            self._add({"kind": "text", "text": cut(chunk, MAX_TEXT_CHARS), "channel": channel})


def _item(data: dict[str, Any]) -> dict[str, Any] | None:
    """The one form of a display bundle the notebook shows. HTML is never shown: a notebook's
    output is untrusted, so only data the browser draws itself is used."""
    if MIME in data:
        shown: dict[str, Any] = data[MIME]
        return shown
    if "application/vnd.plotly.v1+json" in data:
        figure = {
            "library": "plotly",
            "format": "plotly_json",
            "content": json.dumps(data["application/vnd.plotly.v1+json"]),
        }
        return {"kind": "figure", "figure": figure}
    if "image/png" in data:
        return {"kind": "image", "png_base64": data["image/png"]}
    if "text/plain" in data:
        return {"kind": "text", "text": cut(data["text/plain"], MAX_TEXT_CHARS)}
    return None


class _ThisPython(KernelSpecManager):
    """The kernel runs on the Python this host runs on, the one workers use. Never a `python3`
    kernelspec found in the person's Jupyter folders, which may be another environment."""

    def get_kernel_spec(self, kernel_name: str) -> KernelSpec:
        argv = [sys.executable, "-m", "ipykernel_launcher", "-f", "{connection_file}"]
        return KernelSpec(argv=argv, display_name="Python 3 (sprisk)", language="python")


class Session:
    """One kernel, its client, and the limits it runs under."""

    def __init__(self, limits: Limits, cwd: Path) -> None:
        self.limits = limits
        self.cwd = cwd
        # Set when the kernel restarted between cells; the next cell's answer says so.
        self.lost: str | None = None
        self._start()

    def _start(self) -> None:
        # IPC: local sockets in a private directory, not open TCP ports. The path is absolute
        # because the kernel runs in `cwd`, not where this host started.
        self.sockets = Path(tempfile.mkdtemp(prefix="sprisk-kernel-"))
        self.manager = KernelManager(
            kernel_spec_manager=_ThisPython(),
            kernel_name="sprisk",
            transport="ipc",
            ip=str(self.sockets / "kernel"),
        )
        # The kernel's own stdout is not this host's: that is the pipe Rust reads answers from.
        self.manager.start_kernel(cwd=str(self.cwd), stdout=sys.stderr)
        self.client: BlockingKernelClient = self.manager.blocking_client()
        self.client.start_channels()
        try:
            self.client.wait_for_ready(timeout=STARTUP_SECONDS)
        except RuntimeError as e:
            raise KernelError(f"the kernel did not start: {e}") from e
        reply = self.client.execute_interactive(
            STARTUP, silent=True, store_history=False, timeout=STARTUP_SECONDS
        )
        if reply["content"]["status"] != "ok":
            raise KernelError(f"the kernel's display setup failed: {reply['content']}")

    def _restart(self) -> None:
        self.shutdown()
        self._start()

    def shutdown(self) -> None:
        self.client.stop_channels()
        self.manager.shutdown_kernel(now=True)
        shutil.rmtree(self.sockets)

    def interrupt(self) -> None:
        self.manager.interrupt_kernel()

    def check_idle_memory(self) -> bool:
        """Between cells: a thread a cell started can keep growing. True when it went over the
        cap and the kernel was restarted."""
        if self._memory_mb() <= self.limits.memory_mb:
            return False
        self._restart()
        self.lost = _memory_error(self.limits.memory_mb)["message"]
        return True

    def execute(self, code: str) -> NotebookExecution:
        out = Outputs()
        restarted = self.lost is not None
        if self.lost is not None:
            out.add({"msg_type": "stream", "content": {"name": "stderr", "text": self.lost + "\n"}})
            self.lost = None
        msg_id = self.client.execute(code, store_history=True, allow_stdin=False)
        deadline = time.monotonic() + self.limits.cell_seconds
        timed_out = False
        while True:
            if self._memory_mb() > self.limits.memory_mb:
                self._restart()
                return _done("error", out, _memory_error(self.limits.memory_mb), restarted=True)
            if time.monotonic() > deadline:
                if timed_out:
                    self._restart()
                    return _done("timed_out", out, None, restarted=True)
                self.interrupt()
                timed_out = True
                deadline = time.monotonic() + GRACE_SECONDS
            try:
                msg = self.client.get_iopub_msg(timeout=POLL_SECONDS)
            except queue.Empty:
                if not self.manager.is_alive():
                    self._restart()
                    return _done("error", out, _died(), restarted=True)
                continue
            if msg["parent_header"].get("msg_id") != msg_id:
                continue
            if msg["msg_type"] == "status" and msg["content"]["execution_state"] == "idle":
                break
            out.add(msg)
        try:
            self._reply(msg_id)
        except KernelError:
            self._restart()
            return _done("error", out, _died(), restarted=True)
        if timed_out:
            return _done("timed_out", out, None, restarted=restarted)
        if out.error is not None and out.error["name"] == "KeyboardInterrupt":
            return _done("interrupted", out, out.error, restarted=restarted)
        return _done("error" if out.error else "ok", out, out.error, restarted=restarted)

    def variables(self, names: list[str]) -> NotebookVariables:
        msg_id = self.client.execute(
            "",
            silent=True,
            store_history=False,
            user_expressions={n: TYPE_OF.format(n) for n in names},
        )
        found = self._reply(msg_id)["content"]["user_expressions"]
        variables = []
        for name in names:
            result = found.get(name, {})
            if result.get("status") != "ok":
                variables.append({"name": name, "defined": False, "table": False})
                continue
            kind = ast.literal_eval(result["data"]["text/plain"])
            variables.append(
                {"name": name, "defined": True, "type": kind, "table": kind in TABLE_TYPES}
            )
        return NotebookVariables.model_validate_json(json.dumps({"variables": variables}))

    def _reply(self, msg_id: str) -> dict[str, Any]:
        while True:
            try:
                reply: dict[str, Any] = self.client.get_shell_msg(timeout=GRACE_SECONDS)
            except queue.Empty as e:
                raise KernelError(f"the kernel did not answer request {msg_id}") from e
            if reply["parent_header"].get("msg_id") == msg_id:
                return reply

    def _memory_mb(self) -> float:
        """The kernel's resident memory with its children. A kernel that has gone uses none;
        the caller sees it is not alive."""
        provisioner = self.manager.provisioner
        if not isinstance(provisioner, LocalProvisioner) or provisioner.pid is None:
            raise KernelError("the kernel has no local process to measure")
        try:
            kernel = psutil.Process(provisioner.pid)
            processes = [kernel, *kernel.children(recursive=True)]
            return float(sum(p.memory_info().rss for p in processes)) / 2**20
        except psutil.NoSuchProcess:
            return 0.0


def _done(
    status: str, out: Outputs, error: dict[str, Any] | None, restarted: bool = False
) -> NotebookExecution:
    doc: dict[str, Any] = {"status": status, "outputs": out.items}
    if out.execution_count is not None:
        doc["execution_count"] = out.execution_count
    if error is not None:
        doc["error"] = error
    if restarted:
        doc["kernel_restarted"] = True
    return NotebookExecution.model_validate_json(json.dumps(doc))


def _memory_error(limit_mb: int) -> dict[str, Any]:
    message = f"the kernel used over {limit_mb} MB and was restarted; its variables are gone"
    return {"name": "MemoryLimit", "message": message, "traceback": []}


def _died() -> dict[str, Any]:
    message = "the kernel stopped and was restarted; its variables are gone"
    return {"name": "KernelDied", "message": message, "traceback": []}


def serve(session: Session, requests: queue.Queue[NotebookKernelRequest]) -> None:
    while True:
        try:
            request = requests.get(timeout=POLL_SECONDS)
        except queue.Empty:
            session.check_idle_memory()
            continue
        if isinstance(request.root, KernelExecute):
            answer: NotebookExecution | NotebookVariables = session.execute(request.root.code)
        elif isinstance(request.root, KernelVariables):
            answer = session.variables([n.root for n in request.root.names])
        else:
            return
        sys.stdout.write(answer.model_dump_json(exclude_none=True) + "\n")
        sys.stdout.flush()


def read(session: Session, requests: queue.Queue[NotebookKernelRequest]) -> None:
    """Interrupts act at once; everything else waits its turn. A bad line stops the host."""
    try:
        for line in sys.stdin:
            request = NotebookKernelRequest.model_validate_json(line)
            if request.root.op == "interrupt":
                session.interrupt()
            else:
                requests.put(request)
    finally:
        requests.put(SHUTDOWN)


app = typer.Typer(add_completion=False)


@app.command()
def main(
    cell_seconds: Annotated[float, typer.Option(min=1)],
    memory_mb: Annotated[int, typer.Option(min=64)],
) -> None:
    session = Session(Limits(cell_seconds, memory_mb), Path.cwd())
    requests: queue.Queue[NotebookKernelRequest] = queue.Queue()
    failure: list[BaseException] = []

    def reader() -> None:
        try:
            read(session, requests)
        except Exception as e:  # noqa: BLE001 - reported below, then the host exits non-zero
            failure.append(e)

    threading.Thread(target=reader, daemon=True).start()
    try:
        serve(session, requests)
    finally:
        session.shutdown()
    if failure:
        sys.exit(f"invalid request: {failure[0]}")


if __name__ == "__main__":
    app()
