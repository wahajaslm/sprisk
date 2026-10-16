import hashlib
import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TextIO
from urllib.parse import urlparse
from urllib.request import url2pathname

from jsonschema import Draft202012Validator
from pydantic import BaseModel, ValidationError

from sprisk_contracts import Operator, WorkerMessage
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
from sprisk_workers.errors import ManifestError, OperatorError, ProtocolError
from sprisk_workers.output import CONSOLE_PORT, Output

OperatorFn = Callable[[Mapping[str, Any], Mapping[str, Path], Path], list[Output]]


@dataclass(frozen=True)
class LoadedOperator:
    run: OperatorFn
    output_ports: frozenset[str]
    params_schema: Mapping[str, Any]
    # The manifest, so a step's own code can be checked and called like the built-in (ADR-0028).
    operator: Operator | None = None


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
        sender.send(
            Fail(type="fail", attempt_id=attempt_id, error=f.fail_error, failure_kind=f.kind)
        )
        return
    finally:
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
    # Params are an open map on the wire; every key lands in model_extra.
    params = lease.params.model_extra or {}
    _check_params(lease.operator.root, params, operator.params_schema)
    try:
        inputs = {b.port.root: _verified_input(b.uri, b.content_hash.root) for b in lease.inputs}
        staging.mkdir(parents=True, exist_ok=True)
        outputs = _runner(lease, operator)(params, inputs, staging)
        declared = operator.output_ports | _named_outputs(operator, params)
        return [_manifest(lease.attempt_id.root, o, staging, declared) for o in outputs]
    except OperatorError as e:
        raise _Failure(e.code, e.message, FailureKind.permanent) from e
    except OSError as e:
        raise _Failure(
            "io_error", f"attempt {lease.attempt_id.root}: {e}", FailureKind.transient
        ) from e


def _runner(lease: LeaseAttempt, operator: LoadedOperator) -> OperatorFn:
    """The operator's code, or the step's own code from the lease (ADR-0028), which gets the
    same signature, type and port checks."""
    if lease.code is None:
        return operator.run
    if operator.operator is None:
        raise _Failure(
            "no_manifest",
            f"{lease.operator.root} cannot run its own code here",
            FailureKind.permanent,
        )
    # Imported here: user code runs only in the code-step runner (ADR-0020).
    from sprisk_code.python_step import load_function
    from sprisk_workers.plain import adapt

    try:
        return adapt(load_function(lease.code.source, lease.code.function), operator.operator)
    except ManifestError as e:
        raise OperatorError("code_error", str(e)) from e


def _check_params(operator: str, params: Mapping[str, Any], schema: Mapping[str, Any]) -> None:
    # Rust validates params at compile time; the worker checks again at its own boundary.
    errors = sorted(e.message for e in Draft202012Validator(schema).iter_errors(params))
    if errors:
        raise _Failure("invalid_params", f"{operator}: {'; '.join(errors)}", FailureKind.permanent)


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


def _named_outputs(operator: LoadedOperator, params: Mapping[str, Any]) -> frozenset[str]:
    if operator.operator is None:
        return frozenset()
    from sprisk_workers.plain import named_port_names  # plain imports this module

    return frozenset(named_port_names(operator.operator, params, "output"))


def _manifest(
    attempt_id: str, output: Output, staging: Path, declared: frozenset[str]
) -> ArtifactManifest:
    if output.port not in declared and output.port != CONSOLE_PORT:
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
