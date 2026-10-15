import hashlib
import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TextIO
from urllib.parse import urlparse
from urllib.request import url2pathname

from pydantic import BaseModel, ValidationError

from sprisk_contracts import WorkerMessage
from sprisk_contracts.generated.models import (
    Acknowledge,
    ArtifactManifest,
    Cancel,
    Complete,
    Error,
    Fail,
    FailureKind,
    Handshake,
    Heartbeat,
    LeaseAttempt,
)
from sprisk_workers.errors import OperatorError, ProtocolError
from sprisk_workers.output import Output

OperatorFn = Callable[[Mapping[str, Any], Mapping[str, Path], Path], list[Output]]


@dataclass(frozen=True)
class LoadedOperator:
    run: OperatorFn
    output_ports: frozenset[str]


class _Failure(Exception):
    def __init__(self, code: str, message: str, kind: FailureKind) -> None:
        super().__init__(message)
        self.fail_error = Error(code=code, message=message)
        self.kind = kind


class _Sender:
    """Serialises writes so heartbeats never interleave with other messages."""

    def __init__(self, out: TextIO) -> None:
        self._out = out
        self._lock = threading.Lock()

    def send(self, message: BaseModel) -> None:
        line = message.model_dump_json(exclude_none=True) + "\n"
        with self._lock:
            self._out.write(line)
            self._out.flush()


def serve(
    stdin: TextIO,
    stdout: TextIO,
    worker_id: str,
    operators: Mapping[str, LoadedOperator],
    heartbeat_seconds: float,
) -> None:
    """Handshake, then run each leased attempt until stdin closes."""
    sender = _Sender(stdout)
    sender.send(
        Handshake.model_validate(
            {
                "type": "handshake",
                "protocol_version": "sprisk.worker/v1",
                "worker_id": worker_id,
                "operators": sorted(operators),
            }
        )
    )
    for line in stdin:
        if not line.strip():
            continue
        message = _parse(line).root
        if isinstance(message, LeaseAttempt):
            _run_attempt(message, operators, sender, heartbeat_seconds)
        elif isinstance(message, Acknowledge | Cancel):
            # The worker is idle between attempts; a cancel for a running attempt
            # is enforced by the control plane killing the process.
            continue
        else:
            raise ProtocolError(f"unexpected inbound message type {message.type}")


def _parse(line: str) -> WorkerMessage:
    try:
        return WorkerMessage.model_validate_json(line)
    except ValidationError as e:
        raise ProtocolError(f"invalid worker message: {e}") from e


def _run_attempt(
    lease: LeaseAttempt,
    operators: Mapping[str, LoadedOperator],
    sender: _Sender,
    heartbeat_seconds: float,
) -> None:
    attempt_id = lease.attempt_id
    stop = threading.Event()
    beat = Heartbeat(type="heartbeat", attempt_id=attempt_id)

    def heartbeat() -> None:
        while not stop.wait(heartbeat_seconds):
            sender.send(beat)

    beater = threading.Thread(target=heartbeat, daemon=True)
    beater.start()
    try:
        manifests = _execute(lease, operators)
    except _Failure as f:
        stop.set()
        beater.join()
        sender.send(
            Fail(type="fail", attempt_id=attempt_id, error=f.fail_error, failure_kind=f.kind)
        )
        return
    stop.set()
    beater.join()
    for manifest in manifests:
        sender.send(manifest)
    sender.send(Complete(type="complete", attempt_id=attempt_id))


def _execute(
    lease: LeaseAttempt, operators: Mapping[str, LoadedOperator]
) -> list[ArtifactManifest]:
    operator = operators.get(lease.operator.root)
    if operator is None:
        raise _Failure(
            "unknown_operator", f"worker cannot run {lease.operator.root}", FailureKind.permanent
        )
    staging = _local_path(lease.staging_uri)
    params = lease.params.model_extra or {}
    try:
        inputs = {b.port.root: _verified_input(b.uri, b.content_hash.root) for b in lease.inputs}
        staging.mkdir(parents=True, exist_ok=True)
        outputs = operator.run(params, inputs, staging)
        return [_manifest(lease.attempt_id.root, o, staging, operator) for o in outputs]
    except OperatorError as e:
        raise _Failure(e.code, e.message, FailureKind.permanent) from e
    except OSError as e:
        raise _Failure(
            "io_error", f"attempt {lease.attempt_id.root}: {e}", FailureKind.transient
        ) from e


def _local_path(uri: str) -> Path:
    parsed = urlparse(uri)
    if parsed.scheme != "file":
        raise _Failure(
            "unsupported_uri", f"only file:// URIs are supported, got {uri}", FailureKind.permanent
        )
    return Path(url2pathname(parsed.path))


def _sha256(path: Path) -> str:
    with path.open("rb") as f:
        return "sha256:" + hashlib.file_digest(f, "sha256").hexdigest()


def _verified_input(uri: str, expected: str) -> Path:
    path = _local_path(uri)
    actual = _sha256(path)
    if actual != expected:
        raise _Failure(
            "input_hash_mismatch",
            f"{uri}: expected {expected}, found {actual}",
            FailureKind.permanent,
        )
    return path


def _manifest(
    attempt_id: str, output: Output, staging: Path, operator: LoadedOperator
) -> ArtifactManifest:
    if output.port not in operator.output_ports:
        raise OperatorError("undeclared_output", f"port {output.port!r} is not declared")
    path = output.path.resolve()
    if not path.is_relative_to(staging.resolve()):
        raise OperatorError("output_outside_staging", f"{path} is outside {staging}")
    return ArtifactManifest.model_validate(
        {
            "type": "artifact_manifest",
            "attempt_id": attempt_id,
            "port": output.port,
            "staging_uri": path.as_uri(),
            "content_hash": _sha256(path),
            "media_type": output.media_type,
            "size_bytes": path.stat().st_size,
        }
    )
