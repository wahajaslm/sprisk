"""Worker protocol loop: one JSON line per WorkerMessage over stdio."""

import hashlib
import io
import json
import threading
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest

from sprisk_workers.errors import OperatorError, ProtocolError
from sprisk_workers.output import Output
from sprisk_workers.serve import LoadedOperator, serve

WORKER_ID = "wrk_01JABCDEFGHJKMNPQRSTVWXYZ0"
ATTEMPT_ID = "att_01JABCDEFGHJKMNPQRSTVWXYZ0"
OP = "sprisk.test.echo@1.0.0"


def sha256(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def lease(tmp_path: Path, inputs: list[dict[str, str]] | None = None, op: str = OP) -> str:
    return json.dumps(
        {
            "type": "lease_attempt",
            "attempt_id": ATTEMPT_ID,
            "run_id": "run_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "node_id": "echo",
            "operator": op,
            "params": {"text": "hi"},
            "inputs": inputs or [],
            "staging_uri": (tmp_path / "staging").as_uri() + "/",
            "lease_expires_at": "2026-10-15T10:01:00Z",
        }
    )


def echo(params: Mapping[str, Any], inputs: Mapping[str, Path], out_dir: Path) -> list[Output]:
    path = out_dir / "out.txt"
    text = params["text"] + "".join(p.read_text() for p in inputs.values())
    path.write_text(text)
    return [Output(port="out", path=path, media_type="text/plain")]


def run(
    stdin_lines: list[str], fn: Any = echo, heartbeat_seconds: float = 60.0
) -> list[dict[str, Any]]:
    stdout = io.StringIO()
    ops = {OP: LoadedOperator(run=fn, output_ports=frozenset({"out"}))}
    serve(io.StringIO("\n".join(stdin_lines) + "\n"), stdout, WORKER_ID, ops, heartbeat_seconds)
    return [json.loads(line) for line in stdout.getvalue().splitlines()]


def test_handshake_is_first_and_lists_operators() -> None:
    sent = run([])
    assert sent == [
        {
            "type": "handshake",
            "protocol_version": "sprisk.worker/v1",
            "worker_id": WORKER_ID,
            "operators": [OP],
        }
    ]


def test_lease_runs_operator_then_sends_manifest_and_complete(tmp_path: Path) -> None:
    sent = run([lease(tmp_path)])
    staged = tmp_path / "staging" / "out.txt"
    assert staged.read_text() == "hi"
    assert [m["type"] for m in sent] == ["handshake", "artifact_manifest", "complete"]
    assert sent[1] == {
        "type": "artifact_manifest",
        "attempt_id": ATTEMPT_ID,
        "port": "out",
        "staging_uri": staged.as_uri(),
        "content_hash": sha256(b"hi"),
        "media_type": "text/plain",
        "size_bytes": 2,
    }


def test_inputs_are_verified_and_passed_by_port(tmp_path: Path) -> None:
    src = tmp_path / "in.txt"
    src.write_bytes(b"!")
    binding = {
        "port": "data",
        "artifact_id": "art_01JABCDEFGHJKMNPQRSTVWXYZ0",
        "uri": src.as_uri(),
        "content_hash": sha256(b"!"),
    }
    run([lease(tmp_path, [binding])])
    assert (tmp_path / "staging" / "out.txt").read_text() == "hi!"


def test_input_hash_mismatch_fails_permanently(tmp_path: Path) -> None:
    src = tmp_path / "in.txt"
    src.write_bytes(b"tampered")
    binding = {
        "port": "data",
        "artifact_id": "art_01JABCDEFGHJKMNPQRSTVWXYZ0",
        "uri": src.as_uri(),
        "content_hash": sha256(b"original"),
    }
    sent = run([lease(tmp_path, [binding])])
    assert sent[-1]["type"] == "fail"
    assert sent[-1]["failure_kind"] == "permanent"
    assert sent[-1]["error"]["code"] == "input_hash_mismatch"


def test_missing_input_file_fails_transiently(tmp_path: Path) -> None:
    binding = {
        "port": "data",
        "artifact_id": "art_01JABCDEFGHJKMNPQRSTVWXYZ0",
        "uri": (tmp_path / "gone.txt").as_uri(),
        "content_hash": sha256(b""),
    }
    sent = run([lease(tmp_path, [binding])])
    assert sent[-1]["failure_kind"] == "transient"
    assert sent[-1]["error"]["code"] == "io_error"


def test_unknown_operator_fails_permanently(tmp_path: Path) -> None:
    sent = run([lease(tmp_path, op="sprisk.test.missing@1.0.0")])
    assert sent[-1]["failure_kind"] == "permanent"
    assert sent[-1]["error"]["code"] == "unknown_operator"


def test_operator_error_fails_permanently_with_its_code(tmp_path: Path) -> None:
    def bad(params: Mapping[str, Any], inputs: Mapping[str, Path], out_dir: Path) -> list[Output]:
        raise OperatorError("missing_column", "column 'y' not found")

    sent = run([lease(tmp_path)], fn=bad)
    assert sent[-1] == {
        "type": "fail",
        "attempt_id": ATTEMPT_ID,
        "error": {"code": "missing_column", "message": "column 'y' not found"},
        "failure_kind": "permanent",
    }


def test_output_port_not_declared_fails_permanently(tmp_path: Path) -> None:
    def wrong_port(p: Mapping[str, Any], i: Mapping[str, Path], out_dir: Path) -> list[Output]:
        path = out_dir / "x"
        path.write_text("x")
        return [Output(port="other", path=path, media_type="text/plain")]

    sent = run([lease(tmp_path)], fn=wrong_port)
    assert sent[-1]["error"]["code"] == "undeclared_output"
    assert [m["type"] for m in sent] == ["handshake", "fail"]


def test_output_outside_staging_fails_permanently(tmp_path: Path) -> None:
    def escape(p: Mapping[str, Any], i: Mapping[str, Path], out_dir: Path) -> list[Output]:
        path = tmp_path / "elsewhere.txt"
        path.write_text("x")
        return [Output(port="out", path=path, media_type="text/plain")]

    sent = run([lease(tmp_path)], fn=escape)
    assert sent[-1]["error"]["code"] == "output_outside_staging"


def test_heartbeats_while_operator_runs(tmp_path: Path) -> None:
    stdout = io.StringIO()
    beat_seen = threading.Event()

    class Watch(io.StringIO):
        def write(self, s: str) -> int:
            if '"heartbeat"' in s:
                beat_seen.set()
            return stdout.write(s)

    def slow(params: Mapping[str, Any], inputs: Mapping[str, Path], out_dir: Path) -> list[Output]:
        assert beat_seen.wait(timeout=5)
        return echo(params, inputs, out_dir)

    ops = {OP: LoadedOperator(run=slow, output_ports=frozenset({"out"}))}
    serve(io.StringIO(lease(tmp_path) + "\n"), Watch(), WORKER_ID, ops, heartbeat_seconds=0.01)
    types = [json.loads(line)["type"] for line in stdout.getvalue().splitlines()]
    assert "heartbeat" in types
    assert types[-1] == "complete"


def test_acknowledge_and_cancel_between_attempts_are_accepted(tmp_path: Path) -> None:
    ack = json.dumps({"type": "acknowledge", "attempt_id": ATTEMPT_ID})
    cancel = json.dumps({"type": "cancel", "attempt_id": ATTEMPT_ID})
    sent = run([lease(tmp_path), ack, cancel])
    assert sent[-1]["type"] == "complete"


@pytest.mark.parametrize(
    "line",
    [
        "not json",
        '{"type": "lease_attempt"}',
        json.dumps({"type": "heartbeat", "attempt_id": ATTEMPT_ID}),
    ],
)
def test_invalid_or_unexpected_inbound_message_raises(line: str) -> None:
    with pytest.raises(ProtocolError):
        run([line])
