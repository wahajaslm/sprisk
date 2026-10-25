# ADR-0066: The Copilot goes through the API to a Python provider process
Status: Accepted
Date: 2026-10-25
Arch doc sections: §4 (principles), §14.4 (no customer data to external LLMs by default), §17.1 (one API). Changes ADR-0048 (adapters live in Python, not `sprisk-api`). Follows ADR-0014.

## Context
- The Copilot called Ollama straight from the browser through a Vite proxy (`/ollama`).
- That is a private agent route (rule 4), an LLM call outside Python (rule 2), and it worked only on the dev server.
- ADR-0048 put provider adapters in `sprisk-api`. That breaks rule 2. No adapter was built.

## Decision
- **Two API routes.** `POST /copilot/chat` (`CopilotChatRequest` → `CopilotChatReply`) and `POST /copilot/ledger` (`CopilotLedgerRequest` → `CopilotLedgerDraft`). The browser, CLI and SDK use these only.
- **Rust decides whether AI may run.** `AppState.copilot` is `None` when AI is off; both routes then answer 403 `ai_off`. `sprisk serve --no-ai` turns it off.
- **Local only, for now.** The provider URL is set at start-up, never by a request. Rust refuses a URL whose host is not loopback. External providers wait for the consent policy of ADR-0014.
- **Python calls the model.** Each request runs `python -m sprisk_workers.copilot <chat|ledger> <ollama_url> <model>` as one bounded process (time limit, capped output, cleared environment, at most two at once), like the code writer (ADR-0055). The process holds the prompts and the ledger output schema. It validates the model's answer against the contract before printing it.
- **What leaves the browser stays the same.** Chat sends the messages and the page context. The ledger sends the request text and the column summary it sent before (names, types, counts, missing %). No rows.
- **Dataset text is untrusted.** Column names, the page context and user text go in user messages, never the system prompt.
- The Python module lives in `sprisk-workers` until a planner package (`sprisk-ai`) exists. It is the one place that talks to a model.

## Alternatives considered
- Rust calls Ollama over HTTP. Rejected: LLM calls belong to Python (rule 2).
- A long-lived Python AI service. Rejected: a new deployable (rule 11); one process per request is enough for a chat turn.

## Consequences
- Good: one path for everyone; works without the dev server; AI can be switched off in one place.
- Good: an Ollama timeout or crash is a typed API error, not a hung browser fetch.
- Bad: a Python start per message adds about half a second.
- Not yet: the audit log and PII scan of ADR-0014 rule 4. They are needed before any external provider.

## Validation
- API test: with AI off, both routes answer 403 and start no process.
- API test: with a fake provider process, a chat answer reaches the client.
- Python test: against a fake Ollama HTTP server, chat and ledger requests send the expected payload and parse the answer; a bad answer is a typed error.
- Web test: the Copilot posts to `/api/copilot/chat`, never `/ollama`.
