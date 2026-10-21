import pytest

from sprisk_contracts import NotebookCodeRequest
from sprisk_workers.errors import ManifestError
from sprisk_workers.notebook_code import write_code

REQUEST = NotebookCodeRequest.model_validate_json(
    '{"settings": {"test_fraction": 0.25, "seed": 42, "stratify": "credit_risk"},'
    ' "inputs": {"data": "load_data"}, "outputs": {"train": "split_train", "test": "split_test"}}'
)


def test_a_step_is_written_as_plain_python_with_its_settings_and_names() -> None:
    code = write_code("sprisk_validation.random_split:as_code", REQUEST).code
    assert "from sklearn.model_selection import train_test_split" in code
    assert "stratify=load_data['credit_risk']" in code
    assert code.rstrip().endswith("load_data[sorted(split_test_rows)]")


def test_a_writer_outside_the_core_packs_is_refused() -> None:
    with pytest.raises(ManifestError, match="not in a trusted core pack"):
        write_code("os:getcwd", REQUEST)
