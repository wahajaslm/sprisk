import { parse, type MethodologyRule, type MethodologyRuleSource } from "@sprisk/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import bundle from "../../../contracts/bundle.schema.json";
import multicollinearity from "../../../tests/contract/methodology_rule/valid/multicollinearity.json";
import { useSelection } from "../src/workbench/selection.ts";
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
  it("shows the selected flow's status on each decision, what is next, and why", async () => {
    serve([features, split]);
    server.use(
      http.get("/api/pipeline_versions/:id/methodology/review", () =>
        HttpResponse.json({
          schema_version: "sprisk.methodology_review/v1",
          pipeline_version_id: "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
          items: [
            { rule: split.id, decides: "split.method", stage: "split", subject_node_id: "split", status: "proposal", reason: "Keeps each class's share the same in train and test.", recommended_alternative_id: split.alternatives[0]!.id },
            { rule: features.id, decides: features.decides, stage: "features", status: "waiting", reason: "Waits for split.method, which is still open." },
          ],
          next: [0],
        }),
      ),
    );
    useSelection.setState({ pipelineVersionId: "plv_01JABCDEFGHJKMNPQRSTVWXYZ0" });
    renderWithApi(<MethodologyPage />);

    expect(await screen.findByLabelText("Flow review")).toHaveTextContent("2 open on this flow. Next: split.method (proposal)");
    const map = screen.getByRole("region", { name: "Methodology map" });
    const card = within(map).getByRole("button", { name: split.name });
    expect(within(card).getByText(/Proposal/)).toBeInTheDocument();
    expect(within(within(map).getByRole("button", { name: features.name })).getByText(/Waiting/)).toBeInTheDocument();

    expect(card).not.toHaveClass("dimmed");
    await userEvent.click(screen.getByRole("switch", { name: "Pipeline path" }));
    expect(within(map).getByRole("button", { name: split.name })).not.toHaveClass("dimmed");

    await userEvent.click(card);
    const onFlow = screen.getByRole("region", { name: "On this flow" });
    expect(within(onFlow).getByText("Keeps each class's share the same in train and test.")).toBeInTheDocument();
    useSelection.setState({ pipelineVersionId: undefined });
  });

  it("draws each route as its own node, with the condition that leads to it", async () => {
    serve([features]);
    renderWithApi(<MethodologyPage />);
    const map = await screen.findByRole("region", { name: "Methodology map" });
    const route = features.alternatives.find((a) => a.condition)!;
    expect(await within(map).findByText(route.label)).toBeInTheDocument();
    expect(within(map).getByText(`When ${route.condition}`)).toBeInTheDocument();
  });

  it("knows every stage the contract has, so no rule drops off the page", () => {
    expect(STAGES).toEqual(bundle.$defs.MethodologyStage.enum);
  });


  it("maps the shared stages, then each lane's stages in decision order with the rules from the API under theirs", async () => {
    serve([features, split]);
    renderWithApi(<MethodologyPage />);

    const map = await screen.findByRole("region", { name: "Methodology map" });
    const stages = (await within(map).findAllByRole("heading")).map((h) => h.textContent);
    expect(stages).toEqual(["Question", "Data", "Supervised", "Split", "Features"]);
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

  it("shows an active rule's inputs and examples, and explains its routes by its examples, not design notes", async () => {
    const plain = ({ condition: _, ...a }: MethodologyRule["alternatives"][number]) => a;
    const { observes: _notes, ...withoutNotes } = split;
    const active: MethodologyRule = {
      ...withoutNotes,
      status: "active",
      applies_to: ["sprisk.validation.random_split"],
      reads: ["question.target", "question.time_column"],
      examples: [{ given: { "question.time_column": "signup_date" }, picks: "correlation_pruning" }],
      alternatives: features.alternatives.map(plain),
    };
    serve([active]);
    renderWithApi(<MethodologyPage />);

    const detail = await screen.findByRole("region", { name: active.name });
    expect(within(detail).getByText("question.time_column", { selector: "code" })).toBeInTheDocument();
    const example = within(detail).getByRole("listitem", { name: "Example 1" });
    expect(example).toHaveTextContent("question.time_column = signup_date");
    expect(example).toHaveTextContent("Pairwise Correlation Pruning");
    // An active rule's route is explained by the tested example that picks it, not a design note.
    expect(within(detail).getByText(/^When: .*time column = signup_date/)).toBeInTheDocument();
  });

  it("says a shortlist rule's candidates are the registered models, and shows its examples' shortlists", async () => {
    const { observes: _notes, ...withoutNotes } = split;
    const shortlist: MethodologyRule = {
      ...withoutNotes,
      status: "active",
      selection: "shortlist",
      applies_to: ["sprisk.ml.linear_model"],
      reads: ["rows", "candidate.*.family"],
      alternatives: [],
      examples: [{ given: { rows: 40 }, shortlist: ["ml_dummy_baseline", "ml_linear_model"] }],
    };
    serve([shortlist]);
    renderWithApi(<MethodologyPage />);

    const detail = await screen.findByRole("region", { name: shortlist.name });
    expect(within(detail).getByText(/every registered model that fits the task/i)).toBeInTheDocument();
    expect(within(detail).getByRole("listitem", { name: "Example 1" })).toHaveTextContent("shortlist: ml_dummy_baseline, ml_linear_model");
    expect(within(detail).queryByRole("heading", { name: "Alternatives" })).not.toBeInTheDocument();
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

describe("pipeline path switch", () => {
  it("is off without a flow, and with one dims the decisions the flow has no step for", async () => {
    serve([features, split]);
    server.use(
      http.get("/api/pipeline_versions/:id/methodology/review", () =>
        HttpResponse.json({
          schema_version: "sprisk.methodology_review/v1",
          pipeline_version_id: "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
          items: [{ rule: split.id, decides: "split.method", stage: "split", subject_node_id: "split", status: "settled", reason: "r", recommended_alternative_id: split.alternatives[0]!.id }],
          next: [],
        }),
      ),
    );
    renderWithApi(<MethodologyPage />);
    expect(await screen.findByRole("switch", { name: "Pipeline path" })).toBeDisabled();

    useSelection.setState({ pipelineVersionId: "plv_01JABCDEFGHJKMNPQRSTVWXYZ0" });
    const pathSwitch = await screen.findByRole("switch", { name: "Pipeline path" });
    await screen.findByLabelText("Flow review");
    const map = screen.getByRole("region", { name: "Methodology map" });
    expect(within(map).getByRole("button", { name: features.name })).not.toHaveClass("dimmed");
    await userEvent.click(pathSwitch);
    expect(within(map).getByRole("button", { name: features.name })).toHaveClass("dimmed");
    expect(within(map).getByRole("button", { name: split.name })).not.toHaveClass("dimmed");
    useSelection.setState({ pipelineVersionId: undefined });
  });
});
