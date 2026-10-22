import type { QuestionVersion } from "@sprisk/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import withCosts from "../../../tests/contract/question_version/valid/classification-with-costs.json";
import { QuestionLedger } from "../src/views/QuestionLedger.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

function open(): QuestionVersion[] {
  const posted: QuestionVersion[] = [];
  server.use(
    http.post("/api/question_versions", async ({ request }) => {
      const question = (await request.json()) as QuestionVersion;
      posted.push(question);
      return HttpResponse.json(question, { status: 201 });
    }),
  );
  useSelection.setState({ pipelineVersionId: undefined });
  renderWithApi(<QuestionLedger />);
  return posted;
}

async function costs(positive: string, falseNegative: string, falsePositive: string) {
  const editor = screen.getByRole("dialog", { name: "New question" });
  const section = within(editor).getByRole("group", { name: "Misclassification costs" });
  if (positive) await userEvent.type(within(section).getByLabelText("Positive class"), positive);
  if (falseNegative) await userEvent.type(within(section).getByLabelText("False-negative cost"), falseNegative);
  if (falsePositive) await userEvent.type(within(section).getByLabelText("False-positive cost"), falsePositive);
}

describe("misclassification costs in the question", () => {
  it("are saved as an explicit fact when all three are given", async () => {
    const posted = open();
    await userEvent.click(await screen.findByRole("button", { name: "New question" }));
    await costs("bad", "5", "1");
    await userEvent.click(screen.getByRole("button", { name: "Save revision" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.costs).toEqual({
      value: { positive: "bad", false_negative: 5, false_positive: 1 },
      origin: "explicit",
    });
  });

  it("are left out when none is given", async () => {
    const posted = open();
    await userEvent.click(await screen.findByRole("button", { name: "New question" }));
    await userEvent.click(screen.getByRole("button", { name: "Save revision" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.costs).toBeUndefined();
  });

  it("must be given in full, as positive numbers, before the revision saves", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: "New question" }));
    await costs("bad", "5", "");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the positive class and both costs, as positive numbers, or none of them.");
    expect(screen.getByRole("button", { name: "Save revision" })).toBeDisabled();
  });

  it("are shown on the question's ledger entry", async () => {
    server.use(http.get("/api/question_versions", () => HttpResponse.json([withCosts])));
    open();
    const entry = await screen.findByRole("article");
    expect(entry).toHaveTextContent("Misclassification costs");
    expect(entry).toHaveTextContent("bad · false negative 5 · false positive 1");
  });
});

describe("interpretability in the question", () => {
  it("is saved as an explicit fact when chosen", async () => {
    const posted = open();
    await userEvent.click(await screen.findByRole("button", { name: "New question" }));
    await userEvent.selectOptions(screen.getByLabelText("Interpretability"), "high");
    await userEvent.click(screen.getByRole("button", { name: "Save revision" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.interpretability).toEqual({ value: "high", origin: "explicit" });
  });

  it("is left out when not stated", async () => {
    const posted = open();
    await userEvent.click(await screen.findByRole("button", { name: "New question" }));
    await userEvent.click(screen.getByRole("button", { name: "Save revision" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.interpretability).toBeUndefined();
  });

  it("is shown on the ledger entry and kept when the question is revised", async () => {
    const stated = { ...withCosts, interpretability: { value: "medium", origin: "explicit" } };
    server.use(http.get("/api/question_versions", () => HttpResponse.json([stated])));
    const posted = open();
    const entry = await screen.findByRole("article");
    expect(entry).toHaveTextContent("Interpretabilitymedium");
    await userEvent.click(within(entry).getByRole("button", { name: "Revise" }));
    await userEvent.click(screen.getByRole("button", { name: "Save revision" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.interpretability).toEqual({ value: "medium", origin: "explicit" });
  });
});
