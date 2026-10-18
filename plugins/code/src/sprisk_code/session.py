"""Session host (ADR-0036): one live ipykernel for one notebook.

Rust starts it in the data root and writes one NotebookKernelRequest per line on stdin. It
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
from jupyter_client.manager import KernelManager
from jupyter_client.provisioning.local_provisioner import LocalProvisioner

from sprisk_code.kernel_display import MIME
from sprisk_code.shown import MAX_FIGURES, MAX_ITEMS, MAX_TEXT_CHARS, cut
from sprisk_contracts import NotebookExecution, NotebookKernelRequest, NotebookVariables

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
            self.error = {
                "name": content["ename"],
                "message": content["evalue"],
                "traceback": [ANSI.sub("", line) for line in content["traceback"]],
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
        if len(self.items) < MAX_ITEMS:
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


class Session:
    """One kernel, its client, and the limits it runs under."""

    def __init__(self, limits: Limits, cwd: Path) -> None:
        self.limits = limits
        self.cwd = cwd
        self._start()

    def _start(self) -> None:
        # IPC: local sockets in a private directory, not open TCP ports. The path is absolute
        # because the kernel runs in the data root, not where this host started.
        self.sockets = Path(tempfile.mkdtemp(prefix="sprisk-kernel-"))
        self.manager = KernelManager(
            kernel_name="python3", transport="ipc", ip=str(self.sockets / "kernel")
        )
        self.manager.start_kernel(cwd=str(self.cwd))
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

    def execute(self, code: str) -> NotebookExecution:
        msg_id = self.client.execute(code, store_history=True, allow_stdin=False)
        out = Outputs()
        deadline = time.monotonic() + self.limits.cell_seconds
        timed_out = False
        while True:
            if self._memory_mb() > self.limits.memory_mb:
                self._restart()
                return _done("error", out, _memory_error(self.limits.memory_mb))
            if time.monotonic() > deadline:
                if timed_out:
                    self._restart()
                    return _done("timed_out", out, None)
                self.interrupt()
                timed_out = True
                deadline = time.monotonic() + GRACE_SECONDS
            try:
                msg = self.client.get_iopub_msg(timeout=POLL_SECONDS)
            except queue.Empty:
                if not self.manager.is_alive():
                    self._restart()
                    return _done("error", out, _died())
                continue
            if msg["parent_header"].get("msg_id") != msg_id:
                continue
            if msg["msg_type"] == "status" and msg["content"]["execution_state"] == "idle":
                break
            out.add(msg)
        self._reply(msg_id)
        if timed_out:
            return _done("timed_out", out, None)
        if out.error is not None and out.error["name"] == "KeyboardInterrupt":
            return _done("interrupted", out, out.error)
        return _done("error" if out.error else "ok", out, out.error)

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


def _done(status: str, out: Outputs, error: dict[str, Any] | None) -> NotebookExecution:
    doc: dict[str, Any] = {"status": status, "outputs": out.items}
    if out.execution_count is not None:
        doc["execution_count"] = out.execution_count
    if error is not None:
        doc["error"] = error
    return NotebookExecution.model_validate_json(json.dumps(doc))


def _memory_error(limit_mb: int) -> dict[str, Any]:
    message = f"the kernel used over {limit_mb} MB and was restarted; its variables are gone"
    return {"name": "MemoryLimit", "message": message, "traceback": []}


def _died() -> dict[str, Any]:
    message = "the kernel stopped and was restarted; its variables are gone"
    return {"name": "KernelDied", "message": message, "traceback": []}


def serve(session: Session, requests: queue.Queue[NotebookKernelRequest]) -> None:
    while True:
        request = requests.get()
        if request.op == "execute":
            answer: NotebookExecution | NotebookVariables = session.execute(request.code or "")
        elif request.op == "variables":
            answer = session.variables([n.root for n in request.names or []])
        else:
            return
        sys.stdout.write(answer.model_dump_json(exclude_none=True) + "\n")
        sys.stdout.flush()


def read(session: Session, requests: queue.Queue[NotebookKernelRequest]) -> None:
    """Interrupts act at once; everything else waits its turn. A bad line stops the host."""
    try:
        for line in sys.stdin:
            request = NotebookKernelRequest.model_validate_json(line)
            if request.op == "interrupt":
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
