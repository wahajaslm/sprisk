//! The settings a study tries (ADR-0051). Trials are graph steps, so they are listed here,
//! before the run, from the finite value lists in a model's manifest.

use itertools::Itertools;
use rand::SeedableRng;
use rand::seq::SliceRandom;
use rand_chacha::ChaCha8Rng;
use serde_json::{Map, Value};
use sprisk_contracts::{SearchSetting, StudyStrategy};

/// One trial's settings, by name.
pub type Settings = Map<String, Value>;

#[derive(Debug, PartialEq, thiserror::Error)]
pub enum BudgetError {
    #[error("this study has {trials} trials; its budget allows {max}")]
    Over { trials: usize, max: u64 },
    #[error(
        "a budget of {max} trials leaves {each} for each tuned model; random search needs at least 2"
    )]
    TooFewToSample { each: usize, max: u64 },
}

/// Every combination of the values, in manifest order with the last setting changing fastest:
/// the points of scikit-learn's `ParameterGrid`, in that order.
pub fn grid(search: &[SearchSetting]) -> Vec<Settings> {
    search
        .iter()
        .map(|s| {
            s.values
                .iter()
                .map(move |v| (s.name.to_string(), v.clone()))
        })
        .multi_cartesian_product()
        .map(Settings::from_iter)
        .collect()
}

/// The first `n` points of the grid shuffled by `seed`: a sample without replacement, as
/// `ParameterSampler` draws from lists. ChaCha8 gives the same shuffle on every platform, and
/// a larger `n` keeps every point a smaller one drew, so finished trials are reused.
pub fn random(search: &[SearchSetting], seed: u64, n: usize) -> Vec<Settings> {
    let mut points = grid(search);
    points.shuffle(&mut ChaCha8Rng::seed_from_u64(seed));
    points.truncate(n);
    points
}

/// How many trials each tuned model gets, given `one_trial` models with nothing to search and
/// each tuned model's grid size. A grid must fit whole; random search shares what the
/// one-trial models leave equally, capped at each grid, and needs at least 2 each.
pub fn trials_per_candidate(
    strategy: StudyStrategy,
    max_trials: u64,
    one_trial: usize,
    grid_sizes: &[usize],
) -> Result<Vec<usize>, BudgetError> {
    let max = max_trials;
    let fits = |trials: usize| u64::try_from(trials).is_ok_and(|t| t <= max);
    match strategy {
        StudyStrategy::Grid => {
            let trials = one_trial + grid_sizes.iter().sum::<usize>();
            if !fits(trials) {
                return Err(BudgetError::Over { trials, max });
            }
            Ok(grid_sizes.to_vec())
        }
        StudyStrategy::Random => {
            if !fits(one_trial) {
                return Err(BudgetError::Over {
                    trials: one_trial,
                    max,
                });
            }
            if grid_sizes.is_empty() {
                return Ok(Vec::new());
            }
            let left = usize::try_from(max).unwrap_or(usize::MAX) - one_trial;
            let each = left / grid_sizes.len();
            if each < 2 {
                return Err(BudgetError::TooFewToSample { each, max });
            }
            Ok(grid_sizes.iter().map(|&size| size.min(each)).collect())
        }
    }
}
