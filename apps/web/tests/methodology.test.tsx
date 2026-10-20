import { parse, type MethodologyRule, type MethodologyRuleSource } from "@sprisk/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import bundle from "../../../contracts/bundle.schema.json";
import multicollinearity from "../../../tests/contract/methodology_rule/valid/multicollinearity.json";
import { MethodologyPage } from "../src/views/methodology/MethodologyPage.tsx";
import { STAGES } from "../src/views/methodology/ruleTree.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const features = parse("MethodologyRule", multicollinearity);
const split: MethodologyRule = {
  ...features,
  id: "methodology.supervised.data_split@1.0.0",
  name: "Data Splitting",
  stage: "split",
  decides: "split.method",
};

const source: MethodologyRuleSource = {
  rule: split.id,
  files: [
    { path: "rule.yaml", language: "yaml", text: "decides: split.method\n" },
    { path: "rule.py", language: "python", text: "def decide(observation, settings):\n    ...\n" },
  ],
};

function serve(rules: MethodologyRule[]) {
  server.use(
    http.get("/api/methodology_rules", () => HttpResponse.json(rules)),
    http.get("/api/methodology_rules/:id/source", ({ params }) =>
      params.id === source.rule ? HttpResponse.json(source) : HttpResponse.json({ errors: [] }, { status: 404 }),
    ),
  );
}

describe("methodology page", () => {
  it("knows every stage the contract has, so no rule drops off the page", () => {
    expect(STAGES).toEqual(bundle.$defs.MethodologyStage.enum);
  });


  it("maps the rules from the API under their stages, in stage order", async () => {
    serve([features, split]);
    renderWithApi(<MethodologyPage />);

    const map = await screen.findByRole("region", { name: "Methodology map" });
    const stages = (await within(map).findAllByRole("heading")).map((h) => h.textContent);
    expect(stages).toEqual(["Split", "Features"]);
    expect(within(map).getByRole("button", { name: /Data Splitting/ })).toBeInTheDocument();
  });

  it("shows what the picked rule decides, its source and its alternatives", async () => {
    serve([features, split]);
    renderWithApi(<MethodologyPage />);

    await userEvent.click(await screen.findByRole("button", { name: /Multicollinearity/ }));
    const detail = screen.getByRole("region", { name: features.name });
    expect(within(detail).getByRole("heading", { level: 1, name: features.name })).toBeInTheDocument();
    expect(within(detail).getByText(features.decides)).toBeInTheDocument();
    expect(within(detail).getByText(features.provenance.citation)).toBeInTheDocument();
    expect(within(detail).getByText("Pairwise Correlation Pruning")).toBeInTheDocument();
  });

  it("shows an active rule's inputs and examples, and no design notes", async () => {
    const [first, ...rest] = features.alternatives;
    const plain = ({ condition: _, ...a }: (typeof rest)[number]) => a;
    const { observes: _notes, ...withoutNotes } = split;
    const active: MethodologyRule = {
      ...withoutNotes,
      status: "active",
      applies_to: ["sprisk.validation.random_split"],
      reads: ["question.target", "question.time_column"],
      examples: [{ given: { "question.time_column": "signup_date" }, picks: "correlation_pruning" }],
      alternatives: [plain(first), ...rest.map(plain)],
    };
    serve([active]);
    renderWithApi(<MethodologyPage />);

    const detail = await screen.findByRole("region", { name: active.name });
    expect(within(detail).getByText("question.time_column", { selector: "code" })).toBeInTheDocument();
    const example = within(detail).getByRole("listitem", { name: "Example 1" });
    expect(example).toHaveTextContent("question.time_column = signup_date");
    expect(example).toHaveTextContent("Pairwise Correlation Pruning");
    expect(within(detail).queryByText(/^When:/)).not.toBeInTheDocument();
  });

  it("marks a draft rule and shows its design notes", async () => {
    serve([features]);
    renderWithApi(<MethodologyPage />);

    await userEvent.click(await screen.findByRole("button", { name: /Multicollinearity/ }));
    const detail = screen.getByRole("region", { name: features.name });
    expect(within(detail).getByText(/Draft: not run yet/)).toBeInTheDocument();
    expect(within(detail).getAllByText(/^When:/).length).toBeGreaterThan(0);
  });

  it("shows each file of the rule's code, read only", async () => {
    serve([split]);
    renderWithApi(<MethodologyPage />);

    await userEvent.click(await screen.findByRole("tab", { name: "Code" }));
    const manifest = await screen.findByRole("textbox", { name: "Code of rule.yaml" });
    expect(manifest).toHaveValue("decides: split.method\n");
    expect(manifest).toHaveAttribute("readonly");

    await userEvent.click(screen.getByRole("button", { name: "rule.py" }));
    expect(await screen.findByRole("textbox", { name: "Code of rule.py" })).toHaveValue(source.files[1]!.text);
  });

  it("says so when a rule's code cannot be read", async () => {
    serve([features]);
    renderWithApi(<MethodologyPage />);

    await userEvent.click(await screen.findByRole("tab", { name: "Code" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("says so when the rules cannot be read", async () => {
    server.use(http.get("/api/methodology_rules", () => HttpResponse.json({ errors: [{ code: "x", message: "boom" }] }, { status: 500 })));
    renderWithApi(<MethodologyPage />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
