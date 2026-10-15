# ADR-0014: AI data exposure policy

Status: Accepted
Date: 2026-10-15
Arch doc sections: §1 (principle 5), §7, §12
Research: [AI privacy and methodology](../research/2026-10-ai-privacy-and-methodology.md)

## Context

The AI planner needs context about the data. Every piece of context sent to an external model leaves the machine. Comparable tools send metadata by default and trust provider contracts. Only one (Dataiku) redacts and audits. One (PandasAI) leaked rows through a buggy privacy flag.

## Decision

### Exposure levels

| Level | Content | Local model | External model |
| --- | --- | --- | --- |
| 0 Goal | User's goal text, operator registry | Allowed | **Default** |
| 1 Schema | Column names and types | **Default** | Opt-in per project |
| 2 Profile | Counts, missing %, numeric ranges. No text top-values. | **Default** | Opt-in per project |
| 3 Sample | Real rows | Opt-in per dataset | Opt-in per dataset, explicit approval each time |
| 4 Full data | All rows | Never | Never |

### Rules

1. **Local model is the default.** No external provider is configured on install.
2. **External providers are opt-in per project**, and only providers with a zero-retention agreement on record.
3. **Text top-values are never in profiles sent to an AI.** That is where names and emails leak.
4. **One outbound gate.** Every message to any model passes one function in the planner process: level check → privacy transforms → PII scan (redact or block) → audit log → send. No other code path can reach a provider.
5. **Audit log.** Every outbound message is logged locally: time, project, provider, model, exposure level, redactions, the exact text sent. Viewable by the user.
6. **Secrets never** enter prompts, at any level.
7. **Privacy transforms are registered operators** (`sprisk.privacy.*`), not gate-only code. The gate runs them; users and the AI can also put them in pipelines (e.g. pseudonymize before export). Mapping tables (token → real value) are artifacts that never leave the machine.

   | Operator | Does |
   | --- | --- |
   | `pseudonymize` | Replace values with stable tokens (`EMAIL_17`) |
   | `alias_columns` | Rename columns; per column: real name, alias, or alias + user description |
   | `generalize` | Bin numbers, coarsen dates and locations |
   | `suppress_rare` | Replace categories seen fewer than k times with `other` |
   | `noisy_profile` | Profile with calibrated noise on counts and means |
   | `synthesize_sample` | Fake rows matching the profile, used instead of real rows at level 3 |

8. **Dataset text is untrusted.** It goes in the user/data part of a prompt, never the system prompt, and never changes tool permissions.

## Alternatives considered

- External AI on by default with metadata only (Hex, Databricks). Rejected: conflicts with local-first and "no silent data transfer".
- A single privacy flag. Rejected: one bug leaks everything (PandasAI).

## Consequences

- M2 needs a working local model runtime (e.g. Ollama) before AI planning works out of the box.
- Planning quality on local models may be lower. Users can opt into external providers knowingly.
- Contracts needed in M2: `ExposureLevel`, provider policy, audit record.
- A `privacy` operator pack. `pseudonymize` and `suppress_rare` are needed by M2; the rest can follow.
- Transforms reduce risk; they do not make data anonymous (combinations of columns can re-identify people). Consent and audit stay required.

## Validation

- Acceptance test §15.8: with default settings, a network-capturing test sees no dataset content leave the machine.
- Test: a profile with an email-like top value is redacted or blocked before send.
- Test: every provider call appears in the audit log; there is no call path that bypasses the gate.
