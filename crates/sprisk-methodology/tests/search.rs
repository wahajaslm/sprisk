#![allow(clippy::unwrap_used, clippy::expect_used)]

use serde_json::{Value, json};
use sprisk_contracts::{SearchSetting, StudyStrategy};
use sprisk_methodology::search::{BudgetError, grid, random, trials_per_candidate};

fn space() -> Vec<SearchSetting> {
    serde_json::from_value(json!([
        { "name": "min_samples_leaf", "values": [1, 5, 20] },
        { "name": "max_features", "values": [0.3, 1.0] },
    ]))
    .unwrap()
}

fn points(settings: &[serde_json::Map<String, Value>]) -> Vec<Value> {
    settings.iter().map(|s| Value::Object(s.clone())).collect()
}

#[test]
fn a_grid_is_every_combination_with_the_last_setting_changing_fastest() {
    let all = points(&grid(&space()));
    assert_eq!(all.len(), 6);
    assert_eq!(
        all[0],
        json!({ "min_samples_leaf": 1, "max_features": 0.3 })
    );
    assert_eq!(
        all[1],
        json!({ "min_samples_leaf": 1, "max_features": 1.0 })
    );
    assert_eq!(
        all[5],
        json!({ "min_samples_leaf": 20, "max_features": 1.0 })
    );
}

#[test]
fn a_random_sample_repeats_by_seed_never_repeats_a_point_and_grows_by_its_prefix() {
    let five = points(&random(&space(), 7, 5));
    assert_eq!(five, points(&random(&space(), 7, 5)));
    let mut distinct = five.iter().map(Value::to_string).collect::<Vec<_>>();
    distinct.sort();
    distinct.dedup();
    assert_eq!(distinct.len(), 5);
    assert_eq!(points(&random(&space(), 7, 3)), five[..3]);
    assert_ne!(points(&random(&space(), 8, 6)), points(&grid(&space())));
    assert_eq!(
        random(&space(), 7, 50).len(),
        6,
        "a sample is at most the grid"
    );
}

#[test]
fn a_grid_must_fit_its_budget() {
    assert_eq!(
        trials_per_candidate(StudyStrategy::Grid, 8, 2, &[6]).unwrap(),
        [6]
    );
    let over = trials_per_candidate(StudyStrategy::Grid, 7, 2, &[6]).unwrap_err();
    assert_eq!(over, BudgetError::Over { trials: 8, max: 7 });
    assert_eq!(
        over.to_string(),
        "this study has 8 trials; its budget allows 7"
    );
}

#[test]
fn random_search_shares_the_budget_equally_capped_at_each_grid() {
    // 2 one-trial models leave 9 trials: 4 each, the remainder unused.
    assert_eq!(
        trials_per_candidate(StudyStrategy::Random, 11, 2, &[6, 12]).unwrap(),
        [4, 4]
    );
    assert_eq!(
        trials_per_candidate(StudyStrategy::Random, 40, 2, &[6, 12]).unwrap(),
        [6, 12]
    );
    assert_eq!(
        trials_per_candidate(StudyStrategy::Random, 5, 2, &[6, 12]).unwrap_err(),
        BudgetError::TooFewToSample { each: 1, max: 5 }
    );
    assert_eq!(
        trials_per_candidate(StudyStrategy::Random, 1, 2, &[6]).unwrap_err(),
        BudgetError::Over { trials: 2, max: 1 }
    );
}
