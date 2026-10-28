"""Settings the splits share, with the range a person may set."""

from typing import Annotated

from sprisk import Between

TestFraction = Annotated[float, Between(0.05, 0.40, step=0.05)]
Seed = Annotated[int, Between(0, 10000)]
