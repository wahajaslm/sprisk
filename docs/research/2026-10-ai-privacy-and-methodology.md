# Research: AI data privacy and methodology guardrails in comparable tools

Date: 2026-10-15
Feeds: [ADR-0014](../adr/0014-ai-data-exposure-policy.md), [ADR-0015](../adr/0015-first-methodology-packs.md)
Status: agent-gathered, sources linked, not independently verified. "Unclear" means the source was blocked or silent.

## Summary

- Mature tools send **metadata (schema, code, outputs), not rows**, by default.
- They rely on **zero-retention contracts** with AI providers, not technical controls.
- Only **Dataiku** has built-in PII redaction and a prompt audit log.
- On methodology, most tools **warn**. **DataRobot** is the only one that **blocks** (auto-removes high-risk leaky features).

## Part A: AI data privacy

| Tool | Sent to LLM by default | Local model | Controls | Retention |
| --- | --- | --- | --- | --- |
| Hex Magic | Schema, names, code, cell outputs. No rows. [1] | Unclear | Admin toggle [2] | Zero retention by default; no training [1] |
| Databricks Assistant | Prompt, table metadata, errors, code. No row-level data. [3] | Partner models only | Admin setting [3] | Zero-retention endpoints [3] |
| Dataiku LLM Mesh | What the app sends, via the Mesh | Yes (local HF models) [4] | Presidio PII redact/block/alert; full audit trail [4][5] | Per provider |
| Julius AI | Unclear (docs 403) | No evidence | Unclear | No training by providers; SOC 2 [6] |
| Jupyter AI | Prompt, last two exchanges, chosen docs [7] | Yes (Ollama, GPT4All), not default [8] | Only on explicit request [7] | Per provider |
| PandasAI | `df.head()` rows by default; `enforce_privacy` sends names only [9] | Yes | Privacy flag has leak bugs [10] | Per provider |
| H2O h2oGPT | Unclear | Built for local models (unverified) | Unclear | Unclear |

**Incident:** Samsung staff pasted source code and meeting notes into ChatGPT (2023); Samsung capped then banned use. [11]

**Regulation:** EDPB Opinion 28/2024: AI models are not automatically anonymous [12]. EDPB 2025 LLM guide: minimise and pseudonymise before sending data to LLMs [13]. EU AI Act specifics on prompts: not researched.

## Part B: Methodology guardrails

| Tool | Tasks | Leakage | Splits | Blocking vs warning |
| --- | --- | --- | --- | --- |
| DataRobot | Classif., regr., time series | Target-leakage check; high-risk features auto-removed [14] | Time-aware with gap [15]; holdout [16] | **Blocks** high risk, warns moderate |
| H2O Driverless AI | Classif., regr., time series | Per-feature leak report [17] | Time series gap/horizon; fold column | Warns; off with fold column or time series [17] |
| Vertex AutoML | Classif., regr., forecasting | None found | Random 80/10/10 default; chronological option [18] | User-configured |
| PyCaret | Classif., regr., time series | None found | Stratified k-fold; group and time series options [19] | Opt-in |
| Hex, Julius, Databricks | Exploration | None | None | None |

**Kapoor & Narayanan, "Leakage and the reproducibility crisis" (Patterns, 2023)** [20]: leakage in 294+ papers across 17 fields. Taxonomy:
- **L1** no clean split: no test set, preprocessing/feature selection on all data, duplicates.
- **L2** illegitimate features: proxies for the target.
- **L3** test set not from the target distribution: temporal leakage, non-independent samples, sampling bias.

## Sources

1. https://learn.hex.tech/docs/hex-magic/magic-data-privacy
2. https://hex.tech/blog/data-manager/
3. https://docs.databricks.com/aws/en/databricks-ai/databricks-ai-trust
4. https://blog.dataiku.com/llm-mesh
5. https://doc.dataiku.com/dss/latest/generative-ai/guardrails/pii-detection.html
6. https://julius.ai/security
7. https://jupyter-ai.readthedocs.io/en/v2/users/index.html
8. https://blog.jupyter.org/posts/2023/generative-ai-in-jupyter/
9. https://blog.pandas-ai.com/pandas-v1-1/
10. https://github.com/sinaptik-ai/pandas-ai/issues/1374
11. https://www.theregister.com/2023/05/02/samsung_generative_ai_ban/
12. https://www.hunton.com/privacy-and-cybersecurity-law-blog/edpb-publishes-opinion-on-processing-of-personal-data-in-the-context-of-ai-models
13. https://www.edpb.europa.eu/system/files/2025-04/ai-privacy-risks-and-mitigations-in-llms.pdf
14. https://docs.datarobot.com/en/docs/reference/data-ref/data-quality-ref.html
15. https://docs.datarobot.com/en/docs/classic-ui/modeling/time/ts-adv-modeling/ts-date-time.html
16. https://docs.datarobot.com/en/docs/classic-ui/modeling/build-models/adv-opt/partitioning.html
17. https://docs.h2o.ai/driverless-ai/1-10-lts/docs/userguide/leakage-shift-detection.html
18. https://docs.cloud.google.com/vertex-ai/docs/tabular-data/data-splits
19. https://pycaret.readthedocs.io/en/stable/api/classification.html
20. https://www.cell.com/patterns/fulltext/S2666-3899(23)00159-9
