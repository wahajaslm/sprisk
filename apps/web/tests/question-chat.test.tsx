import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import source from "../../../tests/contract/dataset_version/valid/local-csv.json";
import walking from "../../../tests/contract/walk/valid/walking.json";
import { ObjectivePage } from "../src/views/objective/ObjectivePage.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { rakuten } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

/** Every API path asked for, in order. */
function recordRequests(): string[] {
  const paths: string[] = [];
  server.events.removeAllListeners();
  server.events.on("request:start", ({ request }) => {
    paths.push(`${request.method} ${new URL(request.url).pathname}`);
  });
  return paths;
}

function withSource() {
  server.use(
    http.get("/api/dataset_versions", () => HttpResponse.json([source])),
    http.get(`/api/dataset_versions/${source.id}/profile`, () => HttpResponse.json(rakuten)),
  );
}

async function openChat() {
  renderWithApi(<ObjectivePage />);
  await userEvent.click(await screen.findByRole("button", { name: /diabetes\.csv/ }));
  return screen.findByRole("log", { name: "Conversation" });
}

const click = async (name: string) => userEvent.click(await screen.findByRole("button", { name }));
const ledger = () => screen.getByRole("complementary", { name: "Ledger draft" });

describe("the question conversation on the Objective page", () => {
  beforeEach(() => useSelection.setState({ nav: "Objective", pipelineVersionId: undefined }));

  it("opens with a message built from the profile, without asking a model", async () => {
    const paths = recordRequests();
    withSource();
    const log = await openChat();

    expect(
      await within(log).findByText(
        "diabetes.csv · 84,916 rows · 4 columns. prdtypecode has 27 classes. Predict it from designation and description?",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Predict prdtypecode" })).toBeInTheDocument();
    expect(paths.some((p) => p.includes("/copilot/"))).toBe(false);
  });

  it("asks one question at a time and fills the ledger draft from chips alone", async () => {
    const paths = recordRequests();
    withSource();
    const log = await openChat();

    await click("Predict prdtypecode");
    expect(within(ledger()).getByText("prdtypecode")).toBeInTheDocument();
    expect(await within(log).findByText("Is prdtypecode a class to pick or a number to estimate?")).toBeInTheDocument();
    // Only the next question's choices are offered.
    expect(screen.queryByRole("button", { name: "Weighted F1" })).toBeNull();

    await click("Classification");
    expect(within(ledger()).getByText("classification")).toBeInTheDocument();
    await click("Skip");
    await click("Weighted F1");
    await click("0.8");
    expect(within(ledger()).getByText("weighted_f1 ≥ 0.8")).toBeInTheDocument();
    await click("No limit on the model");

    expect(await within(log).findByText("That is enough to start. Check the ledger, then start the auto run.")).toBeInTheDocument();
    expect(paths.some((p) => p.includes("/copilot/"))).toBe(false);
  });

  it("asks the Copilot through the API when it cannot read a typed answer, then asks again", async () => {
    let sent: { messages: { role: string; content: string }[]; context?: string } | undefined;
    withSource();
    server.use(
      http.post("/api/copilot/chat", async ({ request }) => {
        sent = (await request.json()) as typeof sent;
        return HttpResponse.json({ content: "The code column with 27 values looks like the label." });
      }),
    );
    const log = await openChat();

    await userEvent.type(screen.getByRole("textbox", { name: "Your answer" }), "which one is the label?{enter}");

    expect(await within(log).findByText("The code column with 27 values looks like the label.")).toBeInTheDocument();
    expect(sent?.messages.at(-1)).toEqual({ role: "user", content: "which one is the label?" });
    expect(sent?.context).toContain("Which column should be predicted?");
    expect(screen.getByRole("button", { name: "Predict prdtypecode" })).toBeInTheDocument();
    expect(within(ledger()).queryByText("prdtypecode")).toBeNull();
  });

  it("completes with AI off, and Start auto run saves the question the person confirmed, then starts on the source file", async () => {
    let saved: Record<string, unknown> | undefined;
    let walk: Record<string, unknown> | undefined;
    withSource();
    server.use(
      http.post("/api/copilot/chat", () =>
        HttpResponse.json({ errors: [{ code: "ai_off", message: "AI is off on this server" }] }, { status: 403 }),
      ),
      http.post("/api/question_versions", async ({ request }) => {
        saved = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(saved, { status: 201 });
      }),
      http.post("/api/walks", async ({ request }) => {
        walk = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(walking, { status: 201 });
      }),
      http.get(`/api/walks/${walking.id}`, () => HttpResponse.json({ walk: walking, steps: [] })),
    );
    const log = await openChat();

    await userEvent.type(screen.getByRole("textbox", { name: "Your answer" }), "no idea{enter}");
    expect(await within(log).findByText(/AI is off on this server/)).toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox", { name: "Your answer" }), "Predict prdtypecode for each listing{enter}");
    await click("Classification");
    await userEvent.type(screen.getByRole("textbox", { name: "Your answer" }), "one product listing{enter}");
    await click("Balanced accuracy");
    await userEvent.type(screen.getByRole("textbox", { name: "Your answer" }), "75%{enter}");
    await click("Must read the model");
    expect(saved).toBeUndefined();

    await click("Start auto run");

    await waitFor(() => expect(walk).toBeDefined());
    expect(saved).toMatchObject({
      objective: { value: "Predict prdtypecode for each listing", origin: "explicit" },
      task: { value: "classification", origin: "confirmed" },
      target: { value: "prdtypecode", origin: "explicit" },
      unit_of_analysis: { value: "one product listing", origin: "explicit" },
      success_bar: { value: { metric: "balanced_accuracy", score: 0.75 }, origin: "explicit" },
      interpretability: { value: "high", origin: "explicit" },
    });
    expect(walk).toMatchObject({ question_version_id: saved?.id, sources: ["/data/diabetes.csv"] });
    expect(await screen.findByText("Auto run in progress")).toBeInTheDocument();
  });
});
