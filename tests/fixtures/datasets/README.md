# Dataset fixtures

Small public datasets for end-to-end tests. Written once from scikit-learn's bundled copies.

| File | Rows | Task | Source |
| --- | --- | --- | --- |
| `iris.csv` | 150 | classification (`species`) | Fisher (1936), UCI; `sklearn.datasets.load_iris` |
| `penguins_raw.csv` | 344 | classification (`Species`); raw: long text, `NA` for missing | Gorman, Williams & Fraser (2014), Palmer Station LTER; CC0, via the `palmerpenguins` R package |
| `diabetes.csv` | 442 | regression (`progression`) | Efron et al. (2004); `sklearn.datasets.load_diabetes(scaled=False)` |
| `german_credit.csv` | 1000 | classification (`credit_risk`: 700 `good`, 300 `bad`) | Hofmann (1994), Statlog (German Credit Data), UCI, [doi:10.24432/C5NC77](https://doi.org/10.24432/C5NC77); CC BY 4.0 |

scikit-learn is BSD-3-Clause; both datasets are public domain or freely redistributable in that package.

## `german_credit.csv`

- Source: `german.data` from the UCI archive, downloaded 21 October 2026 (SHA-256 `b21f3d81db8071257d5ff1deaeba1fd4303b62712e6fcc9715c7a86202cb5871`).
- Licence: CC BY 4.0. Credit: Hans Hofmann, Statlog (German Credit Data), UCI Machine Learning Repository.
- Conversion:
  - space-separated rows became CSV;
  - the 20 attributes got snake_case names in UCI order;
  - the class 1 became `good` and 2 became `bad`, in `credit_risk`.
- Category codes such as `A11` are kept as UCI gives them. UCI's `german.doc` explains each code.
- UCI rates calling a bad customer good as five times worse than the reverse.
