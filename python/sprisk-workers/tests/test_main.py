"""The worker as a real process: JSON lines in on stdin, out on stdout."""

import json
import subprocess
import sys
from pathlib import Path

import polars as pl

PLUGINS = Path(__file__).parents[3] / "plugins"


def test_process_runs_a_leased_source_attempt(tmp_path: Path) -> None:
    csv = tmp_path / "d.csv"
    csv.write_text("a\n1\n2\n")
    lease = {
        "type": "lease_attempt",
        "attempt_id": "att_01JABCDEFGHJKMNPQRSTVWXYZ0",
        "run_id": "run_01JABCDEFGHJKMNPQRSTVWXYZ0",
        "node_id": "load",
        "operator": "sprisk.io.file_source@1.0.0",
        "params": {"path": str(csv), "format": "csv"},
        "inputs": [],
        "staging_uri": (tmp_path / "staging").as_uri() + "/",
        "lease_expires_at": "2026-10-15T10:01:00Z",
    }
    proc = subprocess.run(
        [sys.executable, "-m", "sprisk_workers", "--plugins-root", str(PLUGINS)],
        input=json.dumps(lease) + "\n",
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    )
    sent = [json.loads(line) for line in proc.stdout.splitlines()]
    assert [m["type"] for m in sent] == ["handshake", "artifact_manifest", "complete"]
    assert sent[0]["worker_id"].startswith("wrk_")
    assert pl.read_parquet(tmp_path / "staging" / "data.parquet")["a"].to_list() == [1, 2]


def test_invalid_inbound_message_exits_nonzero() -> None:
    proc = subprocess.run(
        [sys.executable, "-m", "sprisk_workers", "--plugins-root", str(PLUGINS)],
        input="garbage\n",
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode != 0
    assert "invalid worker message" in proc.stderr
