# ADR-0068: A question is drafted in a conversation that starts from the data
Status: Accepted
Date: 2026-10-27
Arch doc sections: §4 (principles 3 and 4), §7 (question ledger), §14.4 (no data to external LLMs by default). Builds on ADR-0063, ADR-0066 and ADR-0067.

## Context
- The Objective page asked "What do you want to find out?" and sent the answer to the local model in one call that filled the whole ledger (`POST /copilot/ledger`).
- With a 7B local model that call takes tens of seconds. Then the person sees a form, not a conversation.
- With AI off, the page could not draft a question at all.
- Most ledger facts can be offered from the dataset profile: the target candidates, the task, the metric choices.

## Decision
- **Start from the data.** The person first picks a registered data source (ADR-0067). The first message is built from its profile by plain code, with no model: size, the likely target and its classes, the text columns.
- **One question at a time.** A fixed order of ledger slots: target (with objective), task, unit of analysis, success bar metric, success bar score, interpretability. Each asks one short question.
- **Choices come from the profile.** Each question offers chips built from the profile, the suggested one first. A typed answer is matched by plain code: a column name, a metric name, a number, `high`/`medium`/`low`. The unit is free text.
- **The model only talks; it never fills a slot.** A typed answer that the code cannot match goes to `POST /copilot/chat` (ADR-0066) with the current question as page context. The reply is shown, and the same question is asked again. AI off: the page says so and asks again.
- **The ledger is a side panel.** It shows the draft as it fills. The conversation is the main view.
- **The person confirms the record.** "Start auto run" saves the draft as a `QuestionVersion` and starts the walk on it. Nothing is saved before that click (rule 3).
- **Origins stay honest.** A chip the page suggested and the person picked is `confirmed`. A typed answer is `explicit`. Nothing the model said becomes a fact.
- **Dataset text stays untrusted.** Column names reach the model only inside the page context, which Python sends as a user message (ADR-0066).
- **No new dependency.** The flow is a small pure TypeScript module.

## Alternatives considered
Researched before writing (root CLAUDE.md):
- **Rasa CALM** (Apache-2.0, mature): flows are deterministic; an LLM only turns text into commands. This is the pattern we follow. Rasa itself is rejected: a Python dialogue server is a new deployable (rule 11).
- **LangGraph `interrupt()` slot filling** (MIT): the graph pauses for each slot. Rejected: the model drives the state, it needs a checkpointer (server session state), and it adds a large dependency for six slots.
- **assistant-ui** (MIT, ~13k stars): a React chat kit. Rejected for now: it is built around a streaming model runtime. Our turns are mostly chips with no model, and the chat list is a few dozen lines.
- **instructor / outlines** for structured extraction: not needed here, since the model never fills a slot. The ledger route already constrains output with Ollama's JSON schema `format`, the same mechanism.
- **Keep the one-shot ledger call.** Rejected as the main path: slow, and empty with AI off. It stays behind "Infer with Copilot".

## Consequences (good and bad)
- Good: a question is drafted in seconds, and fully with AI off.
- Good: every fact in the draft came from a click or typed words, never from the model.
- Bad: free-form answers like "make it 85 percent on F1" only match when the code can read them; otherwise the person picks a chip.
- Bad: the walk still takes file paths. The page fills in the path only for a single local CSV or Parquet file.

## Validation
- Web: the opening is built from a fixture profile; questions come one at a time; chip answers fill the ledger without a model call; with AI off the ledger still completes; "Start auto run" posts the `QuestionVersion` and then the walk; an unmatched answer posts to `/api/copilot/chat`.
