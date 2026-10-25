# ADR-0048: Copilot chat via subscription CLI bridges and local models
Status: Proposed. Changed by [ADR-0066](0066-copilot-goes-through-the-api-to-a-python-provider.md): provider adapters run in Python, behind the API.
Date: 2026-10-21
Arch doc sections: §2A (Cockpit workbench, Copilot view), §7 (AI planning), §12 (trust boundaries). Builds on ADR-0010, ADR-0014, ADR-0018.

## Context
- The studio cockpit workbench includes a dedicated dockable Copilot view ([Copilot.tsx](../../apps/web/src/views/Copilot.tsx)) positioned alongside the flow canvas.
- Forcing users to purchase separate, usage-metered developer API keys (Anthropic Console `sk-ant-...`, OpenAI platform credits) introduces significant friction and duplicate expenses for users who already pay for monthly AI subscriptions (Claude Pro/Team, GitHub Copilot, ChatGPT Plus).
- Users also require 100% offline and zero-cost options that do not leak data across networks.
- Anthropic provides the official `claude` (Claude Code) CLI tool, which authenticates directly against personal Claude subscriptions and provides a headless non-interactive mode (`claude -p --output-format stream-json`). Similarly, GitHub provides `gh copilot`.

## Decision
- **Provider-agnostic Copilot architecture in `sprisk-api`:**
  - The API control plane exposes a unified streaming chat endpoint (`POST /copilot/chat`) backed by a pluggable adapter trait (`AiProviderAdapter`).
  - **Claude Subscription Adapter (`ClaudeCliAdapter`):** Spawns a headless local process of the installed `claude` CLI (`claude -p "<prompt>" --output-format stream-json`), reusing the user's existing authenticated Claude Pro/Team subscription. Responses stream back via Server-Sent Events (SSE) with zero per-token API billing.
  - **GitHub Copilot Adapter (`GithubCopilotAdapter`):** Bridges to `gh copilot` for users with active GitHub Copilot subscriptions.
  - **Local Offline Adapter (`OllamaAdapter`):** Direct HTTP/WebSocket streaming to local Ollama instances (`http://localhost:11434`), supporting local models (e.g. Qwen 2.5 Coder, Llama 3.2, DeepSeek-R1) at $0 cost and zero external network exposure.
- **Context-Aware Cockpit Shell ([Copilot.tsx](../../apps/web/src/views/Copilot.tsx)):**
  - The Copilot chat composer connects to the `useSelection()` bus. It automatically embeds active context based on user focus:
    - Flow node selected: embeds operator ID, params, and methodology warnings.
    - Dataset selected: embeds column schemas and data profile summaries.
    - Notebook cell focused: embeds cell code and error traces.
  - Includes a model/provider selector in the panel header, allowing the user to toggle between their Claude subscription, GitHub Copilot, or local Ollama.
- **Strict Privacy & Data Protection:**
  - In compliance with [ADR-0014](0014-ai-data-exposure-policy.md), the Copilot adapter transmits only metadata, schemas, and rule justifications. Raw data rows are never forwarded into prompts.

## Alternatives considered
- **Require Anthropic / OpenAI API keys only:** Rejected: Users resent paying duplicate per-token fees when they already maintain $20/month consumer/developer subscriptions.
- **Direct browser cookie extraction for web chat:** Rejected: Fragile, brittle against Cloudflare challenges, and violates web service terms. Using official headless CLI tools (Claude Code CLI, GitHub CLI) is robust, supported, and secure.
- **Local models only:** Rejected: While privacy-preserving, complex mathematical and architectural queries benefit from frontier models (Claude 3.7 Sonnet).

## Consequences (good and bad)
- Good: Users leverage their existing Claude or GitHub subscriptions with zero extra API charges.
- Good: Provides a seamless, VS Code-like inline Copilot experience inside the Sprisk Cockpit.
- Good: Fully supports offline, zero-cost operation via local Ollama.
- Bad: The CLI subprocess bridge requires the respective CLI tool (`claude` or `gh`) to be installed and authenticated on the host machine.
- Bad: Local subprocess management requires careful timeout, cancellation, and zombie-process cleanup in Rust.

## Validation
- When `ClaudeCliAdapter` is selected, `POST /copilot/chat` invokes the local `claude` binary and streams tokens without requiring an `ANTHROPIC_API_KEY` environment variable.
- Selecting a node in the flow canvas updates the context chip in `Copilot.tsx` and informs Copilot responses.
- When offline or disconnected, selecting `OllamaAdapter` succeeds against `localhost:11434`.
