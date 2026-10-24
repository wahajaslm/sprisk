import type { DatasetProfile, QuestionVersion, TaskType, Unknown } from "@sprisk/contracts";
import { ulid } from "ulid";

export const COPILOT_MODEL = "qwen2.5:7b";

export interface QuestionLedgerInferenceResult {
  question: QuestionVersion;
  copilotClarification: string;
  unknowns: string[];
}

export interface CopilotChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Compact dataset summary for LLM context window efficiency
export function summarizeDatasetProfile(profile: DatasetProfile | undefined) {
  if (!profile) return undefined;
  return {
    total_rows: profile.total_rows,
    total_columns: profile.total_columns,
    columns: profile.columns.map((c) => {
      const isCandidateTarget = c.distinct > 1 && c.distinct <= 50;
      const isCandidateId = c.distinct === profile.total_rows;
      return {
        name: c.name,
        type: c.data_type,
        distinct: c.distinct,
        missing: c.missing,
        missing_pct: profile.total_rows > 0 ? Number(((c.missing / profile.total_rows) * 100).toFixed(1)) : 0,
        ...(isCandidateTarget ? { candidate_target_or_class: true } : {}),
        ...(isCandidateId ? { candidate_id: true } : {}),
      };
    }),
  };
}

const LEDGER_SCHEMA = {
  type: "object",
  properties: {
    objective: {
      type: "object",
      properties: {
        value: { type: "string" },
        origin: { type: "string", enum: ["explicit", "inferred"] },
      },
      required: ["value", "origin"],
      additionalProperties: false,
    },
    task: {
      type: "object",
      properties: {
        value: { type: "string", enum: ["classification", "regression", "exploration", "undetermined"] },
        origin: { type: "string", enum: ["explicit", "inferred"] },
      },
      required: ["value", "origin"],
      additionalProperties: false,
    },
    target: {
      anyOf: [
        {
          type: "object",
          properties: {
            value: { type: "string" },
            origin: { type: "string", enum: ["explicit", "inferred"] },
          },
          required: ["value", "origin"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    entity_column: {
      anyOf: [
        {
          type: "object",
          properties: {
            value: { type: "string" },
            origin: { type: "string", enum: ["explicit", "inferred"] },
          },
          required: ["value", "origin"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    time_column: {
      anyOf: [
        {
          type: "object",
          properties: {
            value: { type: "string" },
            origin: { type: "string", enum: ["explicit", "inferred"] },
          },
          required: ["value", "origin"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    prediction_horizon: {
      anyOf: [
        {
          type: "object",
          properties: {
            value: { type: "string" },
            origin: { type: "string", enum: ["explicit", "inferred"] },
          },
          required: ["value", "origin"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    costs: {
      anyOf: [
        {
          type: "object",
          properties: {
            value: {
              type: "object",
              properties: {
                positive: { type: "string" },
                false_negative: { type: "number" },
                false_positive: { type: "number" },
              },
              required: ["positive", "false_negative", "false_positive"],
            },
            origin: { type: "string", enum: ["explicit", "inferred"] },
          },
          required: ["value", "origin"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    interpretability: {
      anyOf: [
        {
          type: "object",
          properties: {
            value: { type: "string" },
            origin: { type: "string", enum: ["explicit", "inferred"] },
          },
          required: ["value", "origin"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    success_bar: {
      anyOf: [
        {
          type: "object",
          properties: {
            value: { type: "string" },
            origin: { type: "string", enum: ["explicit", "inferred"] },
          },
          required: ["value", "origin"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    copilot_clarification: {
      type: "string",
      description: "Friendly, concise explanation directly to user acknowledging findings from profile and clarifying questions.",
    },
    unknowns: {
      type: "array",
      items: { type: "string" },
      maxItems: 3,
    },
  },
  required: [
    "objective",
    "task",
    "target",
    "entity_column",
    "time_column",
    "prediction_horizon",
    "costs",
    "interpretability",
    "success_bar",
    "copilot_clarification",
    "unknowns",
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are Sprisk Copilot, an expert machine learning scientist assisting users to formulate an audited Question Ledger.

A background dataset profiler has already analyzed the uploaded dataset and provided schema statistics (column types, null rates, candidate IDs, distinct counts, candidate classes).

Given the user's natural language request and the profiler summary:
1. Complete the Question Ledger fields:
   - Every non-null fact must be an object {"value": "...", "origin": "explicit"} or {"value": "...", "origin": "inferred"}.
   - If a target is implied or clearly indicated by the dataset profiler (e.g. low-cardinality discrete code matching product categories), propose it with origin "inferred".
   - Do NOT invent arbitrary pipeline filtering rules (e.g., dropping missing rows).
   - Do NOT invent business costs, interpretability constraints, or success thresholds if not specified; leave them null.
2. In 'copilot_clarification': Provide a brief, professional response directly to the user summarizing what you detected from their dataset and asking any essential clarification questions.
3. In 'unknowns': Up to 3 concise questions on genuinely missing requirements (e.g. metric priority, multimodal handling).`;

export async function inferQuestionLedger(options: {
  userRequest: string;
  datasetProfile?: DatasetProfile;
  investigationId?: string;
}): Promise<QuestionLedgerInferenceResult> {
  const summarizedProfile = summarizeDatasetProfile(options.datasetProfile);

  const payload = {
    model: COPILOT_MODEL,
    stream: false,
    format: LEDGER_SCHEMA,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          user_request: options.userRequest,
          dataset_profile: summarizedProfile,
        }),
      },
    ],
    options: {
      temperature: 0,
      num_predict: 650,
      num_ctx: 4096,
    },
  };

  const response = await fetch("/ollama/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Copilot inference failed (${response.status}): ${await response.text()}`);
  }

  const raw = await response.json();
  const parsed = JSON.parse(raw.message.content);

  // Map to Sprisk QuestionVersion contract (omitting null fields per Sprisk wire spec)
  const question: QuestionVersion = {
    schema_version: "sprisk.question_version/v1",
    id: `qv_${ulid()}`,
    investigation_id: options.investigationId ?? `inv_${ulid()}`,
    objective: parsed.objective,
    task: parsed.task as { value: TaskType; origin: "explicit" | "inferred" },
    ...(parsed.target?.value ? { target: parsed.target } : {}),
    ...(parsed.entity_column?.value ? { unit_of_analysis: parsed.entity_column } : {}),
    ...(parsed.prediction_horizon?.value ? { prediction_horizon: parsed.prediction_horizon } : {}),
    assumptions: [],
    unknowns: (parsed.unknowns ?? []).map((q: string): Unknown => ({
      question: q,
      blocks: "execution",
    })),
    acceptance_criteria: [],
    ...(parsed.costs?.value ? { costs: parsed.costs } : {}),
    created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };

  return {
    question,
    copilotClarification: parsed.copilot_clarification || "Here is the drafted Question Ledger based on your dataset profile.",
    unknowns: parsed.unknowns || [],
  };
}

export async function askCopilot(messages: CopilotChatMessage[], context?: string): Promise<string> {
  const system = `You are Sprisk Copilot, an expert AI embedded in the Sprisk scientific workbench. Current context: ${context || "Studio"}. Be concise, evidence-based, and focused on machine learning methodology, datasets, and pipelines.`;

  const payload = {
    model: COPILOT_MODEL,
    stream: false,
    messages: [{ role: "system", content: system }, ...messages],
    options: {
      temperature: 0.2,
      num_predict: 350,
      num_ctx: 4096,
    },
  };

  const response = await fetch("/ollama/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Copilot chat failed: ${await response.text()}`);
  }

  const raw = await response.json();
  return raw.message.content;
}
