# Dataset fixtures

Small public datasets for end-to-end tests. Written once from scikit-learn's bundled copies.

| File | Rows | Task | Source |
| --- | --- | --- | --- |
| `iris.csv` | 150 | classification (`species`) | Fisher (1936), UCI; `sklearn.datasets.load_iris` |
| `diabetes.csv` | 442 | regression (`progression`) | Efron et al. (2004); `sklearn.datasets.load_diabetes(scaled=False)` |

scikit-learn is BSD-3-Clause; both datasets are public domain or freely redistributable in that package.
