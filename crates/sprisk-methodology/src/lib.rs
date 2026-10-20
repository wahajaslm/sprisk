//! Deterministic methodology resolution. It reads immutable facts and emits proposals only;
//! graph mutation remains an explicit API Apply operation.

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sprisk_contracts::{DecisionProposal, PipelineVersion, QuestionVersion, parse};

pub const SPLIT_RULE: &str = "supervised.data_split@1.0.0";
pub const CLUSTERING_RULE: &str = "unsupervised.clustering_algorithm@1.0.0";
pub const MISSINGNESS_RULE: &str = "supervised.missingness@1.0.0";
pub const SCALING_RULE: &str = "supervised.feature_scaling@1.0.0";
pub const OUTLIER_RULE: &str = "supervised.outlier_treatment@1.0.0";
pub const ENCODING_RULE: &str = "supervised.categorical_encoding@1.0.0";
pub const IMBALANCE_RULE: &str = "supervised.class_imbalance@1.0.0";
pub const ANOMALY_RULE: &str = "unsupervised.unsupervised_anomaly@1.0.0";
pub const MANIFOLD_RULE: &str = "unsupervised.manifold_projection@1.0.0";

#[derive(Debug, thiserror::Error)]
pub enum ResolveError {
    #[error("node {0} does not exist")]
    UnknownNode(String),
    #[error("node {0} is not a supported split")]
    NotSplit(String),
    #[error("node {0} is not an applicable operator: {1}")]
    IncompatibleOperator(String, String),
    #[error("could not construct proposal: {0}")]
    Contract(#[from] sprisk_contracts::ContractError),
    #[error("could not serialize proposal input: {0}")]
    Json(#[from] serde_json::Error),
}

pub fn resolve_split(
    question: &QuestionVersion,
    pipeline: &PipelineVersion,
    node_id: &str,
    proposal_id: &str,
    created_at: &str,
) -> Result<DecisionProposal, ResolveError> {
    let node = pipeline
        .nodes
        .iter()
        .find(|node| node.id.as_str() == node_id)
        .ok_or_else(|| ResolveError::UnknownNode(node_id.to_owned()))?;
    if !node.operator.as_str().starts_with("sprisk.validation.")
        || !node.operator.as_str().contains("split@")
    {
        return Err(ResolveError::NotSplit(node_id.to_owned()));
    }

    let mut evidence = Vec::new();
    let target = fact(&question.target, "Target", &mut evidence);
    let time = fact(&question.time_column, "Time column", &mut evidence);
    let entity = fact(&question.entity_column, "Entity column", &mut evidence);
    if let Some(horizon) = &question.prediction_horizon {
        evidence.push(evidence_json("Prediction horizon", horizon));
    }

    let temporal = alternative(
        "temporal",
        "Temporal split",
        "Train on earlier observations and test on later observations.",
        time.as_ref(),
        "A confirmed time column represents the prediction chronology.",
        "The time column must be explicit, measured, or confirmed before it can control the split.",
        |column| json!({"kind":"replace_node","node_id":node_id,"operator":"sprisk.validation.temporal_split@1.0.0","params":{"time_column":column,"test_fraction":0.2}}),
    );
    let grouped = alternative(
        "entity",
        "Entity split",
        "Keep every entity wholly in train or test.",
        entity.as_ref(),
        "A confirmed entity key prevents the same entity appearing on both sides.",
        "The entity column must be explicit, measured, or confirmed before it can control the split.",
        |column| json!({"kind":"replace_node","node_id":node_id,"operator":"sprisk.validation.group_split@1.0.0","params":{"group_column":column,"test_fraction":0.2,"seed":42}}),
    );
    let mut random_params = json!({"test_fraction":0.2,"seed":42});
    if let Some((target, _)) = &target {
        random_params["stratify"] = json!(target);
    }
    let random = json!({
        "id":"random", "label":"Random split",
        "description":"Shuffle rows with a repeatable seed.", "applicability":"applicable",
        "reason": if time.is_some() || entity.is_some() { "Available as a baseline, but it does not preserve declared time or entity boundaries." } else { "No authoritative time or entity column is available." },
        "effect":{"kind":"replace_node","node_id":node_id,"operator":"sprisk.validation.random_split@1.0.0","params":random_params}
    });
    let recommended = if time
        .as_ref()
        .is_some_and(|(_, authoritative)| *authoritative)
    {
        "temporal"
    } else if entity
        .as_ref()
        .is_some_and(|(_, authoritative)| *authoritative)
    {
        "entity"
    } else {
        "random"
    };
    let fingerprint_input =
        json!({"rule":SPLIT_RULE,"question":question,"pipeline":pipeline,"node_id":node_id});
    let fingerprint = format!(
        "sha256:{}",
        hex::encode(Sha256::digest(serde_json::to_vec(&fingerprint_input)?))
    );
    let value = json!({
        "schema_version":"sprisk.decision_proposal/v1", "id":proposal_id, "rule":SPLIT_RULE,
        "question_version_id":question.id, "pipeline_version_id":pipeline.id,
        "subject_node_id":node_id, "evidence":evidence,
        "alternatives":[temporal, grouped, random],
        "recommended_alternative_id":recommended, "fingerprint":fingerprint, "created_at":created_at
    });
    Ok(parse(&serde_json::to_string(&value)?)?)
}

pub fn resolve_clustering(
    question: &QuestionVersion,
    pipeline: &PipelineVersion,
    node_id: &str,
    proposal_id: &str,
    created_at: &str,
    expected_geometry: Option<&str>,
    soft_membership: bool,
    has_noise: bool,
) -> Result<DecisionProposal, ResolveError> {
    let _node = pipeline
        .nodes
        .iter()
        .find(|node| node.id.as_str() == node_id)
        .ok_or_else(|| ResolveError::UnknownNode(node_id.to_owned()))?;

    let mut evidence = Vec::new();
    if let Some(geom) = expected_geometry {
        evidence.push(json!({"kind":"question_fact","label":"Cluster Geometry","value":geom,"origin":"confirmed"}));
    }
    if soft_membership {
        evidence.push(json!({"kind":"question_fact","label":"Soft Membership","value":"true","origin":"confirmed"}));
    }
    if has_noise {
        evidence.push(json!({"kind":"question_fact","label":"Noise Tolerance","value":"true","origin":"confirmed"}));
    }

    let kmeans = json!({
        "id":"kmeans",
        "label":"K-Means++ Centroid Clustering",
        "description":"Partition observations into K convex Voronoi cells minimizing within-cluster inertia.",
        "applicability":"applicable",
        "reason": if expected_geometry == Some("non_convex") { "Available as a baseline, but assumes spherical convex clusters." } else { "Compact convex clusters without extreme background noise." },
        "effect":{"kind":"replace_node","node_id":node_id,"operator":"sprisk.clustering.kmeans@1.0.0","params":{"n_clusters":3,"n_init":10,"max_iter":300}}
    });

    let dbscan = json!({
        "id":"dbscan",
        "label":"DBSCAN Density-Based Spatial Clustering",
        "description":"Discover arbitrary non-convex clusters and isolate noise points into label -1.",
        "applicability":"applicable",
        "reason": if has_noise || expected_geometry == Some("non_convex") { "Recommended for non-spherical geometries or isolating noisy background points." } else { "Available density-based alternative." },
        "effect":{"kind":"replace_node","node_id":node_id,"operator":"sprisk.clustering.dbscan@1.0.0","params":{"eps":0.5,"min_samples":5}}
    });

    let gmm = json!({
        "id":"gmm",
        "label":"Gaussian Mixture Models (EM Soft Probabilities)",
        "description":"Fit a mixture of K multivariate Gaussian distributions with calibrated posterior probabilities.",
        "applicability":"applicable",
        "reason": if soft_membership { "Recommended: outputs calibrated probabilistic memberships for borderline samples." } else { "Available probabilistic clustering alternative." },
        "effect":{"kind":"replace_node","node_id":node_id,"operator":"sprisk.clustering.gmm@1.0.0","params":{"n_components":3,"covariance_type":"full"}}
    });

    let recommended = if has_noise || expected_geometry == Some("non_convex") {
        "dbscan"
    } else if soft_membership {
        "gmm"
    } else {
        "kmeans"
    };

    let fingerprint_input =
        json!({"rule":CLUSTERING_RULE,"question":question,"pipeline":pipeline,"node_id":node_id});
    let fingerprint = format!(
        "sha256:{}",
        hex::encode(Sha256::digest(serde_json::to_vec(&fingerprint_input)?))
    );
    let value = json!({
        "schema_version":"sprisk.decision_proposal/v1", "id":proposal_id, "rule":CLUSTERING_RULE,
        "question_version_id":question.id, "pipeline_version_id":pipeline.id,
        "subject_node_id":node_id, "evidence":evidence,
        "alternatives":[kmeans, dbscan, gmm],
        "recommended_alternative_id":recommended, "fingerprint":fingerprint, "created_at":created_at
    });
    Ok(parse(&serde_json::to_string(&value)?)?)
}

pub fn resolve_missingness(
    question: &QuestionVersion,
    pipeline: &PipelineVersion,
    node_id: &str,
    proposal_id: &str,
    created_at: &str,
    column: &str,
    missing_fraction: f64,
    is_target: bool,
    model_family: Option<&str>,
) -> Result<DecisionProposal, ResolveError> {
    let _node = pipeline
        .nodes
        .iter()
        .find(|n| n.id.as_str() == node_id)
        .ok_or_else(|| ResolveError::UnknownNode(node_id.to_owned()))?;

    let mut evidence = vec![
        json!({"kind": "profile_fact", "label": "Column", "value": column, "origin": "measured"}),
        json!({"kind": "profile_fact", "label": "Missing Fraction", "value": format!("{:.2}%", missing_fraction * 100.0), "origin": "measured"}),
    ];
    if is_target {
        evidence.push(json!({"kind": "question_fact", "label": "Target Column", "value": "true", "origin": "confirmed"}));
    }
    if let Some(family) = model_family {
        evidence.push(json!({"kind": "question_fact", "label": "Planned Model Family", "value": family, "origin": "confirmed"}));
    }

    let drop_rows = json!({
        "id": "drop_rows",
        "label": "Drop Missing Rows",
        "description": "Drop rows containing missing values in the specified column.",
        "applicability": "applicable",
        "reason": if is_target { "Target columns must NEVER be imputed; missing ground truth labels must be dropped." } else { "Drops rows with unobserved values." },
        "effect": {
            "kind": "replace_node",
            "node_id": node_id,
            "operator": "sprisk.clean.drop_missing@1.0.0",
            "params": { "columns": [column] }
        }
    });

    let median_impute = json!({
        "id": "median_impute",
        "label": "Median Imputation with Missingness Indicator",
        "description": "Fill missing values with training median and retain a missingness indicator flag.",
        "applicability": if is_target { "not_applicable" } else { "applicable" },
        "reason": if is_target { "Target values must not be imputed." } else { "Standard robust numerical imputation avoiding distributional distortion." },
        "effect": {
            "kind": "replace_node",
            "node_id": node_id,
            "operator": "sprisk.clean.impute@1.0.0",
            "params": { "columns": [column], "method": "median" }
        }
    });

    let is_tree = model_family == Some("tree_based")
        || model_family == Some("xgboost")
        || model_family == Some("lightgbm");
    let native_tree = json!({
        "id": "native_tree_null",
        "label": "Native GBDT Null Routing",
        "description": "Retain missing values untouched; let decision tree splits determine optimal routing.",
        "applicability": if is_target { "not_applicable" } else if is_tree { "applicable" } else { "not_applicable" },
        "reason": if is_tree { "Tree-based gradient boosters naturally partition missing values into dedicated branches." } else { "Requires tree-based model family." }
    });

    let recommended = if is_target {
        "drop_rows"
    } else if is_tree {
        "native_tree_null"
    } else {
        "median_impute"
    };

    let fingerprint_input = json!({"rule": MISSINGNESS_RULE, "question": question, "pipeline": pipeline, "node_id": node_id, "col": column});
    let fingerprint = format!(
        "sha256:{}",
        hex::encode(Sha256::digest(serde_json::to_vec(&fingerprint_input)?))
    );
    let value = json!({
        "schema_version": "sprisk.decision_proposal/v1",
        "id": proposal_id,
        "rule": MISSINGNESS_RULE,
        "question_version_id": question.id,
        "pipeline_version_id": pipeline.id,
        "subject_node_id": node_id,
        "evidence": evidence,
        "alternatives": [drop_rows, median_impute, native_tree],
        "recommended_alternative_id": recommended,
        "fingerprint": fingerprint,
        "created_at": created_at
    });
    Ok(parse(&serde_json::to_string(&value)?)?)
}

pub fn resolve_scaling(
    question: &QuestionVersion,
    pipeline: &PipelineVersion,
    node_id: &str,
    proposal_id: &str,
    created_at: &str,
    columns: &[String],
    kurtosis: f64,
    has_outliers: bool,
    model_family: Option<&str>,
) -> Result<DecisionProposal, ResolveError> {
    let _node = pipeline
        .nodes
        .iter()
        .find(|n| n.id.as_str() == node_id)
        .ok_or_else(|| ResolveError::UnknownNode(node_id.to_owned()))?;

    let is_tree = model_family == Some("tree_based")
        || model_family == Some("random_forest")
        || model_family == Some("xgboost");
    let mut evidence = vec![
        json!({"kind": "profile_fact", "label": "Feature Kurtosis", "value": format!("{:.2}", kurtosis), "origin": "measured"}),
        json!({"kind": "profile_fact", "label": "Extreme Outliers Present", "value": if has_outliers { "true" } else { "false" }, "origin": "measured"}),
    ];
    if let Some(family) = model_family {
        evidence.push(json!({"kind": "question_fact", "label": "Planned Model Family", "value": family, "origin": "confirmed"}));
    }

    let robust = json!({
        "id": "robust_scaler",
        "label": "Robust Scaling (Median & IQR)",
        "description": "Center on median and scale by interquartile range (IQR), resistant to leverage points.",
        "applicability": "applicable",
        "reason": if has_outliers || kurtosis > 3.0 { "Heavy-tailed distributions or outliers contaminate standard mean/variance." } else { "Available robust centering alternative." },
        "effect": {
            "kind": "replace_node",
            "node_id": node_id,
            "operator": "sprisk.clean.scale@1.0.0",
            "params": { "columns": columns, "method": "robust" }
        }
    });

    let standard = json!({
        "id": "standard_scaler",
        "label": "Standard Z-Score Scaling",
        "description": "Center to zero mean and scale to unit variance.",
        "applicability": "applicable",
        "reason": if is_tree { "Available, but decision trees are monotonic scale invariant." } else { "Standard scaling for symmetric Gaussian features." },
        "effect": {
            "kind": "replace_node",
            "node_id": node_id,
            "operator": "sprisk.clean.scale@1.0.0",
            "params": { "columns": columns, "method": "z_score" }
        }
    });

    let bypass = json!({
        "id": "bypass_scaling",
        "label": "Bypass Feature Scaling",
        "description": "Preserve raw feature units without transformation.",
        "applicability": "applicable",
        "reason": if is_tree { "Tree-based models evaluate split points monotonically; linear scaling has zero effect." } else { "Only appropriate for tree ensembles or unscaled domain features." }
    });

    let recommended = if is_tree {
        "bypass_scaling"
    } else if has_outliers || kurtosis > 3.0 {
        "robust_scaler"
    } else {
        "standard_scaler"
    };

    let fingerprint_input = json!({"rule": SCALING_RULE, "question": question, "pipeline": pipeline, "node_id": node_id});
    let fingerprint = format!(
        "sha256:{}",
        hex::encode(Sha256::digest(serde_json::to_vec(&fingerprint_input)?))
    );
    let value = json!({
        "schema_version": "sprisk.decision_proposal/v1",
        "id": proposal_id,
        "rule": SCALING_RULE,
        "question_version_id": question.id,
        "pipeline_version_id": pipeline.id,
        "subject_node_id": node_id,
        "evidence": evidence,
        "alternatives": [robust, standard, bypass],
        "recommended_alternative_id": recommended,
        "fingerprint": fingerprint,
        "created_at": created_at
    });
    Ok(parse(&serde_json::to_string(&value)?)?)
}

pub fn resolve_outlier_treatment(
    question: &QuestionVersion,
    pipeline: &PipelineVersion,
    node_id: &str,
    proposal_id: &str,
    created_at: &str,
    columns: &[String],
    outlier_percentage: f64,
    model_family: Option<&str>,
) -> Result<DecisionProposal, ResolveError> {
    let _node = pipeline
        .nodes
        .iter()
        .find(|n| n.id.as_str() == node_id)
        .ok_or_else(|| ResolveError::UnknownNode(node_id.to_owned()))?;

    let is_tree = model_family == Some("tree_based")
        || model_family == Some("random_forest")
        || model_family == Some("xgboost");
    let mut evidence = vec![
        json!({"kind": "profile_fact", "label": "Outlier Percentage (IQR)", "value": format!("{:.2}%", outlier_percentage * 100.0), "origin": "measured"}),
    ];
    if let Some(family) = model_family {
        evidence.push(json!({"kind": "question_fact", "label": "Planned Model Family", "value": family, "origin": "confirmed"}));
    }

    let winsorize = json!({
        "id": "percentile_winsorize",
        "label": "Standard Deviation Winsorization (Clipping)",
        "description": "Clip extreme leverage points to mean ± 3.0 standard deviations.",
        "applicability": "applicable",
        "reason": if outlier_percentage > 0.02 && !is_tree { "Prevents extreme leverage points from dominating linear regression gradients." } else { "Available standard deviation clipping." },
        "effect": {
            "kind": "replace_node",
            "node_id": node_id,
            "operator": "sprisk.clean.clip_outliers@1.0.0",
            "params": { "columns": columns, "k": 3.0 }
        }
    });

    let tree_bypass = json!({
        "id": "tree_invariance_bypass",
        "label": "Monotonic Invariance (No Treatment)",
        "description": "Preserve raw values: tree splits are invariant to monotonic outlier magnitudes.",
        "applicability": "applicable",
        "reason": if is_tree { "Decision trees split strictly on rank ordering; capping outliers has zero benefit." } else { "Baseline un-clipped representation." }
    });

    let recommended = if is_tree {
        "tree_invariance_bypass"
    } else {
        "percentile_winsorize"
    };

    let fingerprint_input = json!({"rule": OUTLIER_RULE, "question": question, "pipeline": pipeline, "node_id": node_id});
    let fingerprint = format!(
        "sha256:{}",
        hex::encode(Sha256::digest(serde_json::to_vec(&fingerprint_input)?))
    );
    let value = json!({
        "schema_version": "sprisk.decision_proposal/v1",
        "id": proposal_id,
        "rule": OUTLIER_RULE,
        "question_version_id": question.id,
        "pipeline_version_id": pipeline.id,
        "subject_node_id": node_id,
        "evidence": evidence,
        "alternatives": [winsorize, tree_bypass],
        "recommended_alternative_id": recommended,
        "fingerprint": fingerprint,
        "created_at": created_at
    });
    Ok(parse(&serde_json::to_string(&value)?)?)
}

pub fn resolve_categorical_encoding(
    question: &QuestionVersion,
    pipeline: &PipelineVersion,
    node_id: &str,
    proposal_id: &str,
    created_at: &str,
    cardinality: usize,
) -> Result<DecisionProposal, ResolveError> {
    let _node = pipeline
        .nodes
        .iter()
        .find(|n| n.id.as_str() == node_id)
        .ok_or_else(|| ResolveError::UnknownNode(node_id.to_owned()))?;

    let evidence = vec![
        json!({"kind": "profile_fact", "label": "Unique Cardinality", "value": cardinality.to_string(), "origin": "measured"}),
    ];

    let one_hot = json!({
        "id": "one_hot",
        "label": "One-Hot Encoding (drop_first)",
        "description": "Convert discrete levels to binary indicator columns with drop_first=true.",
        "applicability": "applicable",
        "reason": if cardinality <= 10 { "Low cardinality preserves feature compactness and prevents rank-deficiency." } else { "High cardinality causes massive dimensional explosion and sparsity." }
    });

    let target_enc = json!({
        "id": "target_encoding",
        "label": "Out-of-Fold Bayesian Target Encoding",
        "description": "Encode categories as posterior class probabilities with m-estimate smoothing.",
        "applicability": "applicable",
        "reason": if cardinality > 10 { "High cardinality is compactly compressed into 1D continuous signal without sparsity." } else { "Available continuous Bayesian encoding." }
    });

    let recommended = if cardinality <= 10 {
        "one_hot"
    } else {
        "target_encoding"
    };

    let fingerprint_input = json!({"rule": ENCODING_RULE, "question": question, "pipeline": pipeline, "node_id": node_id, "cardinality": cardinality});
    let fingerprint = format!(
        "sha256:{}",
        hex::encode(Sha256::digest(serde_json::to_vec(&fingerprint_input)?))
    );
    let value = json!({
        "schema_version": "sprisk.decision_proposal/v1",
        "id": proposal_id,
        "rule": ENCODING_RULE,
        "question_version_id": question.id,
        "pipeline_version_id": pipeline.id,
        "subject_node_id": node_id,
        "evidence": evidence,
        "alternatives": [one_hot, target_enc],
        "recommended_alternative_id": recommended,
        "fingerprint": fingerprint,
        "created_at": created_at
    });
    Ok(parse(&serde_json::to_string(&value)?)?)
}

pub fn resolve_class_imbalance(
    question: &QuestionVersion,
    pipeline: &PipelineVersion,
    node_id: &str,
    proposal_id: &str,
    created_at: &str,
    minority_fraction: f64,
) -> Result<DecisionProposal, ResolveError> {
    let _node = pipeline
        .nodes
        .iter()
        .find(|n| n.id.as_str() == node_id)
        .ok_or_else(|| ResolveError::UnknownNode(node_id.to_owned()))?;

    let evidence = vec![
        json!({"kind": "profile_fact", "label": "Minority Class Prevalence", "value": format!("{:.2}%", minority_fraction * 100.0), "origin": "measured"}),
    ];

    let cost_weighting = json!({
        "id": "cost_weighting",
        "label": "Cost-Utility Loss Weighting (class_weight='balanced')",
        "description": "Scale gradient loss inversely proportional to class frequencies without distorting sample distributions.",
        "applicability": "applicable",
        "reason": if minority_fraction <= 0.15 { "Optimal for severe imbalance; preserves true probability calibration without synthetic distortion." } else { "Available loss weighting." }
    });

    let smote = json!({
        "id": "smote_train_only",
        "label": "SMOTE (Train Partition Only)",
        "description": "Synthesize k-NN interpolated minority examples strictly on the training partition.",
        "applicability": "applicable",
        "reason": if minority_fraction <= 0.20 && minority_fraction > 0.05 { "Interpolates minority feature manifold when sample size is small." } else { "Available synthetic sampling." }
    });

    let natural = json!({
        "id": "natural_prevalence",
        "label": "Natural Class Distribution",
        "description": "Train on un-weighted natural prevalence.",
        "applicability": "applicable",
        "reason": if minority_fraction > 0.20 { "Class ratio is adequately balanced; no artificial re-weighting needed." } else { "Baseline un-adjusted training." }
    });

    let recommended = if minority_fraction <= 0.05 {
        "cost_weighting"
    } else if minority_fraction <= 0.20 {
        "smote_train_only"
    } else {
        "natural_prevalence"
    };

    let fingerprint_input = json!({"rule": IMBALANCE_RULE, "question": question, "pipeline": pipeline, "node_id": node_id});
    let fingerprint = format!(
        "sha256:{}",
        hex::encode(Sha256::digest(serde_json::to_vec(&fingerprint_input)?))
    );
    let value = json!({
        "schema_version": "sprisk.decision_proposal/v1",
        "id": proposal_id,
        "rule": IMBALANCE_RULE,
        "question_version_id": question.id,
        "pipeline_version_id": pipeline.id,
        "subject_node_id": node_id,
        "evidence": evidence,
        "alternatives": [cost_weighting, smote, natural],
        "recommended_alternative_id": recommended,
        "fingerprint": fingerprint,
        "created_at": created_at
    });
    Ok(parse(&serde_json::to_string(&value)?)?)
}

pub fn resolve_unsupervised_anomaly(
    question: &QuestionVersion,
    pipeline: &PipelineVersion,
    node_id: &str,
    proposal_id: &str,
    created_at: &str,
    contamination: f64,
    is_multimodal: bool,
) -> Result<DecisionProposal, ResolveError> {
    let _node = pipeline
        .nodes
        .iter()
        .find(|n| n.id.as_str() == node_id)
        .ok_or_else(|| ResolveError::UnknownNode(node_id.to_owned()))?;

    let evidence = vec![
        json!({"kind": "profile_fact", "label": "Contamination Expectation", "value": format!("{:.1}%", contamination * 100.0), "origin": "measured"}),
        json!({"kind": "profile_fact", "label": "Multimodal Cluster Density", "value": if is_multimodal { "true" } else { "false" }, "origin": "measured"}),
    ];

    let iforest = json!({
        "id": "isolation_forest",
        "label": "Isolation Forest (Sub-sampling Path Length)",
        "description": "Isolate anomalies via random axis-aligned recursive partitioning in O(N log N).",
        "applicability": "applicable",
        "reason": if !is_multimodal { "Recommended: linear time complexity, robust in high dimensions, immune to swamping and masking." } else { "Global isolation baseline." }
    });

    let lof = json!({
        "id": "local_outlier_factor",
        "label": "Local Outlier Factor (Relative Density)",
        "description": "Detect outliers relative to local neighborhood density.",
        "applicability": "applicable",
        "reason": if is_multimodal { "Recommended: detects anomalies across varying cluster densities where global threshold fails." } else { "Available density-based outlier detector." }
    });

    let elliptic = json!({
        "id": "elliptic_envelope",
        "label": "Elliptic Envelope (FastMCD Covariance)",
        "description": "Fit robust Minimum Covariance Determinant (MCD) Mahalanobis distances.",
        "applicability": "applicable",
        "reason": "Optimal for unimodal elliptical Gaussian distributions."
    });

    let recommended = if is_multimodal {
        "local_outlier_factor"
    } else {
        "isolation_forest"
    };

    let fingerprint_input = json!({"rule": ANOMALY_RULE, "question": question, "pipeline": pipeline, "node_id": node_id});
    let fingerprint = format!(
        "sha256:{}",
        hex::encode(Sha256::digest(serde_json::to_vec(&fingerprint_input)?))
    );
    let value = json!({
        "schema_version": "sprisk.decision_proposal/v1",
        "id": proposal_id,
        "rule": ANOMALY_RULE,
        "question_version_id": question.id,
        "pipeline_version_id": pipeline.id,
        "subject_node_id": node_id,
        "evidence": evidence,
        "alternatives": [iforest, lof, elliptic],
        "recommended_alternative_id": recommended,
        "fingerprint": fingerprint,
        "created_at": created_at
    });
    Ok(parse(&serde_json::to_string(&value)?)?)
}

pub fn resolve_manifold(
    question: &QuestionVersion,
    pipeline: &PipelineVersion,
    node_id: &str,
    proposal_id: &str,
    created_at: &str,
    dimension: usize,
    preserve_global: bool,
) -> Result<DecisionProposal, ResolveError> {
    let _node = pipeline
        .nodes
        .iter()
        .find(|n| n.id.as_str() == node_id)
        .ok_or_else(|| ResolveError::UnknownNode(node_id.to_owned()))?;

    let evidence = vec![
        json!({"kind": "profile_fact", "label": "Feature Dimension", "value": dimension.to_string(), "origin": "measured"}),
        json!({"kind": "profile_fact", "label": "Preserve Global Geometry", "value": if preserve_global { "true" } else { "false" }, "origin": "measured"}),
    ];

    let umap = json!({
        "id": "umap",
        "label": "UMAP (Uniform Manifold Approximation & Projection)",
        "description": "Preserve both local manifold metric and global topological structure.",
        "applicability": "applicable",
        "reason": "Preserves both local clusters and inter-cluster global relationships with fast scalability."
    });

    let tsne = json!({
        "id": "tsne",
        "label": "t-SNE (Probabilistic Neighborhood Affinities)",
        "description": "Minimize KL-divergence of pairwise affinities using Student-t kernel.",
        "applicability": "applicable",
        "reason": "Well-suited for resolving dense local sub-clusters in 2D visual projection."
    });

    let pca = json!({
        "id": "pca_2d",
        "label": "PCA (2D Linear Variance Projection)",
        "description": "Orthogonal linear projection along top 2 eigenvectors.",
        "applicability": "applicable",
        "reason": "Deterministic linear baseline floor."
    });

    let recommended = if preserve_global { "umap" } else { "tsne" };

    let fingerprint_input = json!({"rule": MANIFOLD_RULE, "question": question, "pipeline": pipeline, "node_id": node_id});
    let fingerprint = format!(
        "sha256:{}",
        hex::encode(Sha256::digest(serde_json::to_vec(&fingerprint_input)?))
    );
    let value = json!({
        "schema_version": "sprisk.decision_proposal/v1",
        "id": proposal_id,
        "rule": MANIFOLD_RULE,
        "question_version_id": question.id,
        "pipeline_version_id": pipeline.id,
        "subject_node_id": node_id,
        "evidence": evidence,
        "alternatives": [umap, tsne, pca],
        "recommended_alternative_id": recommended,
        "fingerprint": fingerprint,
        "created_at": created_at
    });
    Ok(parse(&serde_json::to_string(&value)?)?)
}

fn fact(
    fact: &Option<sprisk_contracts::Fact>,
    label: &str,
    evidence: &mut Vec<Value>,
) -> Option<(String, bool)> {
    fact.as_ref().map(|fact| {
        evidence.push(evidence_json(label, fact));
        (
            fact.value.as_str().to_owned(),
            fact.origin != sprisk_contracts::Origin::Inferred,
        )
    })
}

fn evidence_json(label: &str, fact: &sprisk_contracts::Fact) -> Value {
    json!({"kind":"question_fact","label":label,"value":fact.value,"origin":fact.origin})
}

fn alternative(
    id: &str,
    label: &str,
    description: &str,
    fact: Option<&(String, bool)>,
    applicable_reason: &str,
    missing_reason: &str,
    effect: impl FnOnce(&str) -> Value,
) -> Value {
    match fact {
        Some((value, true)) => {
            json!({"id":id,"label":label,"description":description,"applicability":"applicable","reason":applicable_reason,"effect":effect(value)})
        }
        Some((_value, false)) => {
            json!({"id":id,"label":label,"description":description,"applicability":"needs_fact","reason":missing_reason})
        }
        None => {
            json!({"id":id,"label":label,"description":description,"applicability":"needs_fact","reason":missing_reason})
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_question(task: &str, time_col: Option<&str>) -> QuestionVersion {
        let mut val = json!({
            "schema_version": "sprisk.question_version/v1",
            "id": "qv_01JABCDEFGHJKMNPQRSTVWXYZ1",
            "investigation_id": "inv_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "objective": { "value": "Test objective", "origin": "explicit" },
            "task": { "value": task, "origin": "confirmed" },
            "target": { "value": "churn", "origin": "confirmed" },
            "assumptions": [],
            "unknowns": [],
            "acceptance_criteria": [],
            "created_at": "2026-10-15T10:00:00Z"
        });
        if let Some(time) = time_col {
            val["time_column"] = json!({ "value": time, "origin": "confirmed" });
        }
        parse(&val.to_string()).unwrap()
    }

    fn make_test_pipeline(node_id: &str, operator: &str) -> PipelineVersion {
        let val = json!({
            "schema_version": "sprisk.pipeline_version/v1",
            "id": "plv_01JABCDEFGHJKMNPQRSTVWXYZ1",
            "project_id": "prj_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "nodes": [
                {
                    "id": node_id,
                    "operator": operator,
                    "params": {}
                }
            ],
            "edges": [],
            "created_at": "2026-10-15T10:00:00Z"
        });
        parse(&val.to_string()).unwrap()
    }

    #[test]
    fn test_resolve_split_random_default() {
        let question = make_test_question("classification", None);
        let pipeline = make_test_pipeline("split_1", "sprisk.validation.random_split@1.0.0");
        let proposal = resolve_split(
            &question,
            &pipeline,
            "split_1",
            "mpr_01JABCDEFGHJKMNPQRSTVWXYZ1",
            "2026-10-15T10:00:00Z",
        )
        .unwrap();
        assert_eq!(
            proposal
                .recommended_alternative_id
                .as_ref()
                .map(|x| x.as_str()),
            Some("random")
        );
        assert_eq!(proposal.alternatives.len(), 3);
    }

    #[test]
    fn test_resolve_split_temporal_recommended() {
        let question = make_test_question("classification", Some("timestamp"));
        let pipeline = make_test_pipeline("split_1", "sprisk.validation.random_split@1.0.0");
        let proposal = resolve_split(
            &question,
            &pipeline,
            "split_1",
            "mpr_01JABCDEFGHJKMNPQRSTVWXYZ2",
            "2026-10-15T10:00:00Z",
        )
        .unwrap();
        assert_eq!(
            proposal
                .recommended_alternative_id
                .as_ref()
                .map(|x| x.as_str()),
            Some("temporal")
        );
    }

    #[test]
    fn test_resolve_clustering_kmeans_default() {
        let question = make_test_question("exploration", None);
        let pipeline = make_test_pipeline("cluster_1", "sprisk.clustering.kmeans@1.0.0");
        let proposal = resolve_clustering(
            &question,
            &pipeline,
            "cluster_1",
            "mpr_01JABCDEFGHJKMNPQRSTVWXYZ3",
            "2026-10-15T10:00:00Z",
            Some("convex_spherical"),
            false,
            false,
        )
        .unwrap();
        assert_eq!(
            proposal
                .recommended_alternative_id
                .as_ref()
                .map(|x| x.as_str()),
            Some("kmeans")
        );
        assert_eq!(proposal.alternatives.len(), 3);
    }

    #[test]
    fn test_resolve_clustering_dbscan_recommended_for_noise() {
        let question = make_test_question("exploration", None);
        let pipeline = make_test_pipeline("cluster_1", "sprisk.clustering.kmeans@1.0.0");
        let proposal = resolve_clustering(
            &question,
            &pipeline,
            "cluster_1",
            "mpr_01JABCDEFGHJKMNPQRSTVWXYZ4",
            "2026-10-15T10:00:00Z",
            Some("non_convex"),
            false,
            true,
        )
        .unwrap();
        assert_eq!(
            proposal
                .recommended_alternative_id
                .as_ref()
                .map(|x| x.as_str()),
            Some("dbscan")
        );
    }

    #[test]
    fn test_resolve_clustering_gmm_recommended_for_soft_memberships() {
        let question = make_test_question("exploration", None);
        let pipeline = make_test_pipeline("cluster_1", "sprisk.clustering.kmeans@1.0.0");
        let proposal = resolve_clustering(
            &question,
            &pipeline,
            "cluster_1",
            "mpr_01JABCDEFGHJKMNPQRSTVWXYZ5",
            "2026-10-15T10:00:00Z",
            None,
            true,
            false,
        )
        .unwrap();
        assert_eq!(
            proposal
                .recommended_alternative_id
                .as_ref()
                .map(|x| x.as_str()),
            Some("gmm")
        );
    }

    #[test]
    fn test_resolve_missingness_target_drops_rows() {
        let question = make_test_question("classification", None);
        let pipeline = make_test_pipeline("impute_1", "sprisk.clean.impute@1.0.0");
        let proposal = resolve_missingness(
            &question,
            &pipeline,
            "impute_1",
            "mpr_01JABCDEFGHJKMNPQRSTVWXYZ6",
            "2026-10-15T10:00:00Z",
            "churn",
            0.05,
            true,
            None,
        )
        .unwrap();
        assert_eq!(
            proposal
                .recommended_alternative_id
                .as_ref()
                .map(|x| x.as_str()),
            Some("drop_rows")
        );
    }

    #[test]
    fn test_resolve_missingness_features_median_impute() {
        let question = make_test_question("classification", None);
        let pipeline = make_test_pipeline("impute_1", "sprisk.clean.impute@1.0.0");
        let proposal = resolve_missingness(
            &question,
            &pipeline,
            "impute_1",
            "mpr_01JABCDEFGHJKMNPQRSTVWXYZ7",
            "2026-10-15T10:00:00Z",
            "age",
            0.12,
            false,
            Some("linear"),
        )
        .unwrap();
        assert_eq!(
            proposal
                .recommended_alternative_id
                .as_ref()
                .map(|x| x.as_str()),
            Some("median_impute")
        );
    }

    #[test]
    fn test_resolve_scaling_robust_for_outliers() {
        let question = make_test_question("regression", None);
        let pipeline = make_test_pipeline("scale_1", "sprisk.clean.scale@1.0.0");
        let proposal = resolve_scaling(
            &question,
            &pipeline,
            "scale_1",
            "mpr_01JABCDEFGHJKMNPQRSTVWXYZ8",
            "2026-10-15T10:00:00Z",
            &["income".into()],
            6.5,
            true,
            Some("linear"),
        )
        .unwrap();
        assert_eq!(
            proposal
                .recommended_alternative_id
                .as_ref()
                .map(|x| x.as_str()),
            Some("robust_scaler")
        );
        let proposal = serde_json::to_value(&proposal).unwrap();
        let robust = proposal["alternatives"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["id"] == "robust_scaler")
            .unwrap();
        assert_eq!(robust["effect"]["params"]["method"], "robust");
    }

    #[test]
    fn test_resolve_scaling_tree_bypass() {
        let question = make_test_question("classification", None);
        let pipeline = make_test_pipeline("scale_1", "sprisk.clean.scale@1.0.0");
        let proposal = resolve_scaling(
            &question,
            &pipeline,
            "scale_1",
            "mpr_01JABCDEFGHJKMNPQRSTVWXYZ9",
            "2026-10-15T10:00:00Z",
            &["feature".into()],
            1.2,
            false,
            Some("tree_based"),
        )
        .unwrap();
        assert_eq!(
            proposal
                .recommended_alternative_id
                .as_ref()
                .map(|x| x.as_str()),
            Some("bypass_scaling")
        );
    }

    #[test]
    fn test_resolve_categorical_encoding_cardinality() {
        let question = make_test_question("classification", None);
        let pipeline = make_test_pipeline("enc_1", "sprisk.clean.impute@1.0.0");
        let low_card = resolve_categorical_encoding(
            &question,
            &pipeline,
            "enc_1",
            "mpr_01JABCDEFGHJKMNPQRSTVWXYZ0",
            "2026-10-15T10:00:00Z",
            4,
        )
        .unwrap();
        assert_eq!(
            low_card
                .recommended_alternative_id
                .as_ref()
                .map(|x| x.as_str()),
            Some("one_hot")
        );

        let high_card = resolve_categorical_encoding(
            &question,
            &pipeline,
            "enc_1",
            "mpr_01JABCDEFGHJKMNPQRSTVWXYZ1",
            "2026-10-15T10:00:00Z",
            45,
        )
        .unwrap();
        assert_eq!(
            high_card
                .recommended_alternative_id
                .as_ref()
                .map(|x| x.as_str()),
            Some("target_encoding")
        );
    }

    #[test]
    fn test_resolve_class_imbalance() {
        let question = make_test_question("classification", None);
        let pipeline = make_test_pipeline("ml_1", "sprisk.ml.linear_model@1.0.0");
        let extreme = resolve_class_imbalance(
            &question,
            &pipeline,
            "ml_1",
            "mpr_01JABCDEFGHJKMNPQRSTVWXYZ2",
            "2026-10-15T10:00:00Z",
            0.02,
        )
        .unwrap();
        assert_eq!(
            extreme
                .recommended_alternative_id
                .as_ref()
                .map(|x| x.as_str()),
            Some("cost_weighting")
        );

        let moderate = resolve_class_imbalance(
            &question,
            &pipeline,
            "ml_1",
            "mpr_01JABCDEFGHJKMNPQRSTVWXYZ3",
            "2026-10-15T10:00:00Z",
            0.12,
        )
        .unwrap();
        assert_eq!(
            moderate
                .recommended_alternative_id
                .as_ref()
                .map(|x| x.as_str()),
            Some("smote_train_only")
        );
    }

    #[test]
    fn test_resolve_unsupervised_anomaly() {
        let question = make_test_question("exploration", None);
        let pipeline = make_test_pipeline("anom_1", "sprisk.clustering.kmeans@1.0.0");
        let iforest = resolve_unsupervised_anomaly(
            &question,
            &pipeline,
            "anom_1",
            "mpr_01JABCDEFGHJKMNPQRSTVWXYZ4",
            "2026-10-15T10:00:00Z",
            0.05,
            false,
        )
        .unwrap();
        assert_eq!(
            iforest
                .recommended_alternative_id
                .as_ref()
                .map(|x| x.as_str()),
            Some("isolation_forest")
        );

        let lof = resolve_unsupervised_anomaly(
            &question,
            &pipeline,
            "anom_1",
            "mpr_01JABCDEFGHJKMNPQRSTVWXYZ5",
            "2026-10-15T10:00:00Z",
            0.05,
            true,
        )
        .unwrap();
        assert_eq!(
            lof.recommended_alternative_id.as_ref().map(|x| x.as_str()),
            Some("local_outlier_factor")
        );
    }

    #[test]
    fn test_resolve_manifold() {
        let question = make_test_question("exploration", None);
        let pipeline = make_test_pipeline("proj_1", "sprisk.clustering.kmeans@1.0.0");
        let umap = resolve_manifold(
            &question,
            &pipeline,
            "proj_1",
            "mpr_01JABCDEFGHJKMNPQRSTVWXYZ6",
            "2026-10-15T10:00:00Z",
            100,
            true,
        )
        .unwrap();
        assert_eq!(
            umap.recommended_alternative_id.as_ref().map(|x| x.as_str()),
            Some("umap")
        );
    }
}
