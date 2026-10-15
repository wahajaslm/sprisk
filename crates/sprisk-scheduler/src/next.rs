use std::collections::HashSet;

use sprisk_graph::{Plan, Step};

#[derive(Debug, PartialEq)]
pub enum Next<'a> {
    Run(&'a Step),
    Done,
}

/// The first step that has not succeeded. Plan order puts every step after its inputs,
/// so that step's inputs have all succeeded.
pub fn next_step<'a>(plan: &'a Plan, succeeded: &HashSet<String>) -> Next<'a> {
    match plan.steps.iter().find(|s| !succeeded.contains(&s.node_id)) {
        Some(step) => Next::Run(step),
        None => Next::Done,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan(nodes: &[&str]) -> Plan {
        let operator = serde_json::from_value(serde_json::json!({
            "schema_version": "sprisk.operator/v1",
            "id": "sprisk.test.noop@1.0.0",
            "capability_class": "transform",
            "entrypoint": "m:f",
            "inputs": [],
            "outputs": [],
            "params_schema": {},
            "effects": "pure",
            "network": "none",
            "resources": {"cpu_cores": 1, "memory_mb": 1, "gpu": "none", "timeout_seconds": 1}
        }))
        .unwrap_or_else(|e| panic!("{e}"));
        Plan {
            steps: nodes
                .iter()
                .map(|n| Step {
                    node_id: (*n).to_owned(),
                    operator: Clone::clone(&operator),
                    params: serde_json::Map::new(),
                    inputs: vec![],
                })
                .collect(),
        }
    }

    fn done(nodes: &[&str]) -> HashSet<String> {
        nodes.iter().map(|n| (*n).to_owned()).collect()
    }

    #[test]
    fn first_unfinished_step_in_plan_order_runs_next() {
        let p = plan(&["a", "b", "c"]);
        assert_eq!(next_step(&p, &done(&[])), Next::Run(&p.steps[0]));
        assert_eq!(next_step(&p, &done(&["a"])), Next::Run(&p.steps[1]));
    }

    #[test]
    fn all_succeeded_is_done() {
        let p = plan(&["a", "b"]);
        assert_eq!(next_step(&p, &done(&["a", "b"])), Next::Done);
        assert_eq!(next_step(&plan(&[]), &done(&[])), Next::Done);
    }
}
