"""The `matrix` value kind (ADR-0058): rows by named number columns, stored sparse. Row i is
row i of the table it was made from. Word features of free text are one: about 50,000
columns, almost all zeros, that a table would store densely."""

import zipfile
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy import sparse


@dataclass(frozen=True)
class Matrix:
    """Any SciPy sparse matrix comes in (`fit_transform` returns a `csr_matrix`); it is kept
    as a CSR array of finite numbers, one unique name per column."""

    values: sparse.csr_array
    columns: tuple[str, ...]

    def __post_init__(self) -> None:
        if not sparse.issparse(self.values):
            raise ValueError(f"matrix values must be sparse, got {type(self.values).__name__}")
        values = sparse.csr_array(self.values)
        if not np.issubdtype(values.dtype, np.number) or np.iscomplexobj(values.data):
            raise ValueError(f"matrix values must be real numbers, got {values.dtype}")
        if not np.isfinite(values.data).all():
            raise ValueError("matrix values must be finite")
        width = values.shape[1]
        if width != len(self.columns):
            raise ValueError(f"matrix has {width} columns but {len(self.columns)} names")
        repeated = sorted(name for name, n in Counter(self.columns).items() if n > 1)
        if repeated:
            raise ValueError(f"matrix column names repeat: {', '.join(repeated)}")
        object.__setattr__(self, "values", values)


def write_matrix(matrix: Matrix, path: Path) -> None:
    v = matrix.values
    np.savez_compressed(
        path,
        data=v.data,
        indices=v.indices,
        indptr=v.indptr,
        shape=np.array(v.shape),
        columns=np.array(matrix.columns, dtype=np.str_),
    )


def read_matrix(path: Path) -> Matrix:
    """Raises ValueError when the file is not a matrix this module wrote."""
    if not zipfile.is_zipfile(path):
        raise ValueError(f"{path.name} is not an .npz file")
    # No pickles: an .npz of plain arrays cannot run code when it loads.
    with np.load(path, allow_pickle=False) as f:
        missing = sorted({"data", "indices", "indptr", "shape", "columns"} - set(f.files))
        if missing:
            raise ValueError(f"{path.name} has no {', '.join(missing)}")
        values = sparse.csr_array((f["data"], f["indices"], f["indptr"]), shape=tuple(f["shape"]))
        columns = tuple(str(c) for c in f["columns"])
    # The constructor checks only the layout; a full check finds indices outside the shape.
    values.check_format(full_check=True)
    return Matrix(values, columns)
