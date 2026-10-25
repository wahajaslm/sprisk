import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { askCopilot, inferQuestionLedger } from "../src/api/copilot.ts";
import { server } from "./server.ts";

/** Every path the browser asked for, in order. */
function recordRequests(): string[] {
  const paths: string[] = [];
  server.events.removeAllListeners();
  server.events.on("request:start", ({ request }) => {
    paths.push(new URL(request.url).pathname);
  });
  return paths;
}

describe("copilot api", () => {
  it("asks the API for a chat answer, never the model directly", async () => {
    const paths = recordRequests();
    let sent: unknown;
    server.use(
      http.post("/api/copilot/chat", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ content: "Split before you scale." });
      }),
    );

    const reply = await askCopilot([{ role: "user", content: "Which rules apply?" }], "iris.csv · 3 steps");

    expect(reply).toBe("Split before you scale.");
    expect(sent).toEqual({ messages: [{ role: "user", content: "Which rules apply?" }], context: "iris.csv · 3 steps" });
    expect(paths).toEqual(["/api/copilot/chat"]);
    expect(paths.some((p) => p.startsWith("/ollama"))).toBe(false);
  });

  it("drafts a ledger through the API and maps it to a question version", async () => {
    const paths = recordRequests();
    let sent: unknown;
    server.use(
      http.post("/api/copilot/ledger", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({
          objective: { value: "Predict species", origin: "explicit" },
          task: { value: "classification", origin: "inferred" },
          target: { value: "species", origin: "inferred" },
          unit_of_analysis: { value: "id", origin: "inferred" },
          clarification: "",
          unknowns: ["Which metric?"],
        });
      }),
    );

    const result = await inferQuestionLedger({ userRequest: "Predict species", investigationId: "inv_01JABCDEFGHJKMNPQRSTVWXYZ0" });

    expect(sent).toEqual({ user_request: "Predict species" });
    expect(paths).toEqual(["/api/copilot/ledger"]);
    expect(result.question.target).toEqual({ value: "species", origin: "inferred" });
    expect(result.question.unit_of_analysis).toEqual({ value: "id", origin: "inferred" });
    expect(result.question.investigation_id).toBe("inv_01JABCDEFGHJKMNPQRSTVWXYZ0");
    expect(result.question.unknowns).toEqual([{ question: "Which metric?", blocks: "execution" }]);
    expect(result.copilotClarification).toBe("Here is the drafted Question Ledger based on your dataset profile.");
  });

  it("shows the API's refusal when AI is off", async () => {
    server.use(
      http.post("/api/copilot/chat", () =>
        HttpResponse.json({ errors: [{ code: "ai_off", message: "AI is off on this server" }] }, { status: 403 }),
      ),
    );
    await expect(askCopilot([{ role: "user", content: "hi" }])).rejects.toThrow("ai_off: AI is off on this server");
  });
});
