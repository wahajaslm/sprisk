"""The split operators, written with decorators."""

from validation.group_split import group_split
from validation.random_split import random_split
from validation.stratified_split import stratified_split
from validation.temporal_split import temporal_split

PACK = "sprisk.validation"
VERSION = "1.0.0"

__all__ = ["group_split", "random_split", "stratified_split", "temporal_split"]
