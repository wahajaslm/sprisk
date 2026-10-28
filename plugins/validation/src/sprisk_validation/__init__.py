"""Core validation operators: train/test splits."""

from sprisk_validation.group_split import group_split
from sprisk_validation.random_split import random_split
from sprisk_validation.stratified_split import stratified_split
from sprisk_validation.temporal_split import temporal_split

__all__ = ["group_split", "random_split", "stratified_split", "temporal_split"]
