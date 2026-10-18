//! The figures in a step's report, without the rest of it (ADR-0024). A code step's display
//! also holds the tables it showed; those stay on the server.

use sprisk_contracts::{CodeDisplay, FigureSet};

/// The report is not figures and not a code step's display; says why it is neither.
#[derive(Debug, thiserror::Error)]
#[error("not figures ({figures}) and not a code step's display ({display})")]
pub struct NotFigures {
    figures: String,
    display: String,
}

/// The first `limit` figures in a report, in the order the step drew them.
pub fn first_figures(report: &str, limit: usize) -> Result<FigureSet, NotFigures> {
    let figures = match sprisk_contracts::parse::<FigureSet>(report) {
        Ok(set) => {
            let items = set.items.into_iter().take(limit).collect();
            return Ok(FigureSet { items });
        }
        Err(e) => e.to_string(),
    };
    // A Figure has no `kind` and a display item needs one, so a report parses as one or neither.
    let display = sprisk_contracts::parse::<CodeDisplay>(report).map_err(|e| NotFigures {
        figures,
        display: e.to_string(),
    })?;
    let items = display
        .items
        .into_iter()
        .filter_map(|i| i.figure)
        .take(limit)
        .collect();
    Ok(FigureSet { items })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn figure(title: &str) -> serde_json::Value {
        json!({"library": "plotly", "format": "plotly_json", "title": title, "content": "{}"})
    }

    fn titles(set: &FigureSet) -> Vec<String> {
        set.items.iter().filter_map(|f| f.title.clone()).collect()
    }

    #[test]
    fn a_figure_set_gives_its_first_figures() -> Result<(), NotFigures> {
        let report = json!({"items": [figure("a"), figure("b"), figure("c")]}).to_string();
        assert_eq!(titles(&first_figures(&report, 2)?), ["a", "b"]);
        Ok(())
    }

    #[test]
    fn a_code_display_gives_only_its_figures_never_its_tables() -> Result<(), NotFigures> {
        let table = json!({"offset": 0, "total_rows": 1, "total_columns": 1,
            "columns": [{"name": "x", "data_type": "Int64"}],
            "rows": [{"values": ["1"], "missing": []}]});
        let report = json!({"items": [
            {"kind": "text", "text": "hello"},
            {"kind": "table", "table": table},
            {"kind": "figure", "figure": figure("first")},
            {"kind": "figure", "figure": figure("second")},
        ]})
        .to_string();
        assert_eq!(titles(&first_figures(&report, 1)?), ["first"]);
        Ok(())
    }

    #[test]
    fn a_report_with_no_figures_gives_none() -> Result<(), NotFigures> {
        let report = json!({"items": [{"kind": "text", "text": "hello"}]}).to_string();
        assert!(first_figures(&report, 1)?.items.is_empty());
        Ok(())
    }

    #[test]
    fn other_json_is_refused() {
        assert!(first_figures(r#"{"accuracy": 0.9}"#, 1).is_err());
    }

    #[test]
    fn a_refusal_says_what_did_not_parse() {
        let bad = json!({"library": "plotly", "format": "png", "content": "{}"});
        let report = json!({"items": [bad]}).to_string();
        let Err(refused) = first_figures(&report, 1) else {
            panic!("a figure in an unknown format was accepted");
        };
        assert!(refused.to_string().contains("png"), "{refused}");
    }
}
