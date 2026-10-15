from collections.abc import Mapping
from pathlib import Path
from typing import Any

from sprisk_validation.write_split import write_split
from sprisk_workers.output import Output
from sprisk_workers.tables import read_table


def random_split(
    params: Mapping[str, Any], inputs: Mapping[str, Path], out_dir: Path
) -> list[Output]:
    df = read_table(inputs["data"]).sample(fraction=1.0, shuffle=True, seed=params["seed"])
    n_test = round(df.height * params["test_fraction"])
    return write_split(df.slice(n_test), df.head(n_test), out_dir)
