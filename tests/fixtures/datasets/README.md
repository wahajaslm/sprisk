# Dataset fixtures

Small public datasets for end-to-end tests. Written once from scikit-learn's bundled copies.

| File | Rows | Task | Source |
| --- | --- | --- | --- |
| `iris.csv` | 150 | classification (`species`) | Fisher (1936), UCI; `sklearn.datasets.load_iris` |
| `penguins_raw.csv` | 344 | classification (`Species`); raw: long text, `NA` for missing | Gorman, Williams & Fraser (2014), Palmer Station LTER; CC0, via the `palmerpenguins` R package |
| `diabetes.csv` | 442 | regression (`progression`) | Efron et al. (2004); `sklearn.datasets.load_diabetes(scaled=False)` |

scikit-learn is BSD-3-Clause; both datasets are public domain or freely redistributable in that package.
