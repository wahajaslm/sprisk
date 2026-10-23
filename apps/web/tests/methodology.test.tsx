import { parse, type MethodologyReviewItem, type MethodologyRule, type MethodologyRuleSource } from "@sprisk/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import bundle from "../../../contracts/bundle.schema.json";
import multicollinearity from "../../../tests/contract/methodology_rule/valid/multicollinearity.json";
import { useSelection } from "../src/workbench/selection.ts";
import { MethodologyPage } from "../src/views/methodology/MethodologyPage.tsx";
import { ruleTree, STAGES } from "../src/views/methodology/ruleTree.ts";
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

/** The page opens on the map; these tests read the tree. */
async function showTree() {
  await userEvent.click(await screen.findByRole("radio", { name: "Tree" }));
}

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
    await showTree();

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
    await showTree();
    const map = await screen.findByRole("region", { name: "Methodology map" });
    const route = features.alternatives.find((a) => a.condition)!;
    expect(await within(map).findByText(route.label)).toBeInTheDocument();
    expect(within(map).getByText(`When ${route.condition}`)).toBeInTheDocument();
  });

  it("selects the route a person clicks, not its decision, and marks that route beside the map", async () => {
    serve([features]);
    renderWithApi(<MethodologyPage />);
    await showTree();
    const map = await screen.findByRole("region", { name: "Methodology map" });
    const route = features.alternatives[1]!;
    await userEvent.click(await within(map).findByRole("button", { name: route.label }));

    expect(within(map).getByRole("button", { name: route.label })).toHaveAttribute("aria-pressed", "true");
    expect(within(map).getByRole("button", { name: features.name })).toHaveAttribute("aria-pressed", "false");
    const detail = screen.getByRole("region", { name: features.name });
    const marked = within(detail).getAllByRole("listitem").filter((li) => li.getAttribute("aria-current") === "true");
    expect(marked.map((li) => within(li).getByRole("strong").textContent)).toEqual([route.label]);
  });

  it("gives every route the reason it is taken: the flow's own reason, else its condition, else its rationale", () => {
    const [first, second] = features.alternatives;
    const { condition: _unused, ...unconditioned } = second!;
    const plain = { ...features, alternatives: [first!, unconditioned] };
    const reasons = (reviews: Map<string, MethodologyReviewItem>) =>
      ruleTree([plain], reviews, { path: false }).nodes.flatMap((n) => (n.type === "route" ? [n.data.reason] : []));

    expect(reasons(new Map())).toEqual([
      { kind: "when", text: first!.condition },
      { kind: "why", text: second!.rationale },
    ]);
    const review: MethodologyReviewItem = { rule: plain.id, decides: plain.decides, stage: plain.stage, subject_node_id: "model", status: "proposal", reason: "age and income correlate at 0.93.", recommended_alternative_id: second!.id };
    expect(reasons(new Map([[plain.id, review]]))[1]).toEqual({ kind: "because", text: "age and income correlate at 0.93." });
  });

  it("labels the fork into each lane with what sends a question down it", () => {
    const { edges } = ruleTree([features, { ...features, id: "methodology.unsupervised.clusters@1.0.0", decides: "clustering.k" }], new Map(), { path: false });
    const into = (lane: string) => edges.filter((e) => e.target === `lane:${lane}`).map((e) => e.label);
    expect(new Set(into("supervised"))).toEqual(new Set(["the question has a target"]));
    expect(new Set(into("unsupervised"))).toEqual(new Set(["the question has no target"]));
  });

  it("shows the flow diagram of the active rules, and the drafts only when asked", async () => {
    const active: MethodologyRule = { ...split, status: "active" };
    serve([features, active]);
    renderWithApi(<MethodologyPage />);
    await showTree();
    await userEvent.click(await screen.findByRole("radio", { name: "Flow" }));

    const flow = screen.getByRole("region", { name: "Methodology flow" });
    expect(within(flow).getByRole("button", { name: active.name })).toBeInTheDocument();
    expect(within(flow).queryByRole("button", { name: features.name })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Show drafts" }));
    expect(within(screen.getByRole("region", { name: "Methodology flow" })).getByRole("button", { name: features.name })).toBeInTheDocument();
  });

  it("shows one stage at a time in the flow, chosen from the stages in decision order", async () => {
    const splitting: MethodologyRule = { ...split, status: "active" };
    const featuring: MethodologyRule = { ...features, status: "active" };
    serve([featuring, splitting]);
    renderWithApi(<MethodologyPage />);
    await showTree();
    await userEvent.click(await screen.findByRole("radio", { name: "Flow" }));

    const stages = screen.getByRole("navigation", { name: "Stages" });
    expect(within(stages).getAllByRole("button").map((b) => b.textContent)).toEqual(["3 Split1", "4 Features1"]);
    await userEvent.click(within(stages).getByRole("button", { name: /Features/ }));
    expect(within(stages).getByRole("button", { name: /Features/ })).toHaveAttribute("aria-current", "step");
    const flow = screen.getByRole("region", { name: "Methodology flow" });
    expect(within(flow).getByRole("button", { name: featuring.name })).toBeInTheDocument();
    expect(within(flow).queryByRole("button", { name: splitting.name })).not.toBeInTheDocument();
  });

  it("shows each decision as its question, and each route's when with its settings filled in", async () => {
    const worded: MethodologyRule = {
      ...split,
      status: "active",
      question: "How should the rows be split into train and test?",
      policy_thresholds: { default_test_fraction: 0.2 },
      alternatives: split.alternatives.map((a, i) => ({ ...a, when: i === 0 ? "hold out {default_test_fraction} of rows at random" : "never yet: no step does this" })),
    };
    serve([worded]);
    renderWithApi(<MethodologyPage />);
    await showTree();

    const map = await screen.findByRole("region", { name: "Methodology map" });
    expect(within(map).getByRole("button", { name: worded.name })).toHaveTextContent(worded.question!);
    expect(within(map).getByText(/hold out 0.2 of rows at random/)).toBeInTheDocument();
    // The page's heading asks the picked decision as its question.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(worded.question!);

    await userEvent.click(screen.getByRole("radio", { name: "Flow" }));
    const flow = screen.getByRole("region", { name: "Methodology flow" });
    expect(within(flow).getByRole("button", { name: worded.name })).toHaveTextContent(worded.question!);
    expect(within(flow).getByText(/hold out 0.2 of rows at random/)).toBeInTheDocument();
  });

  it("opens on the map canvas of the active rules, where a decision or a route is picked by a click", async () => {
    const splitting: MethodologyRule = { ...split, status: "active", question: "How should the rows be split?" };
    serve([features, splitting]);
    renderWithApi(<MethodologyPage />);

    const canvas = await screen.findByRole("region", { name: "Methodology canvas" });
    expect(within(canvas).getByRole("button", { name: splitting.name })).toHaveTextContent("How should the rows be split?");
    expect(within(canvas).queryByRole("button", { name: features.name })).not.toBeInTheDocument();
    const route = splitting.alternatives[1]!;
    await userEvent.click(within(canvas).getByRole("button", { name: route.label }));
    expect(within(canvas).getByRole("button", { name: route.label })).toHaveAttribute("aria-pressed", "true");
    const detail = screen.getByRole("region", { name: splitting.name });
    expect(within(detail).getAllByRole("listitem").filter((li) => li.getAttribute("aria-current") === "true")).toHaveLength(1);
  });

  it("knows every stage the contract has, so no rule drops off the page", () => {
    expect(STAGES).toEqual(bundle.$defs.MethodologyStage.enum);
  });


  it("maps the shared stages, then each lane's stages in decision order with the rules from the API under theirs", async () => {
    serve([features, split]);
    renderWithApi(<MethodologyPage />);
    await showTree();

    const map = await screen.findByRole("region", { name: "Methodology map" });
    const stages = (await within(map).findAllByRole("heading")).map((h) => h.textContent);
    expect(stages).toEqual(["Question", "Data", "Supervised", "Split", "Features"]);
    expect(within(map).getByRole("button", { name: /Data Splitting/ })).toBeInTheDocument();
  });

  it("shows what the picked rule decides, its source and its alternatives", async () => {
    serve([features, split]);
    renderWithApi(<MethodologyPage />);
    await showTree();

    await userEvent.click(await within(await screen.findByRole("region", { name: "Methodology map" })).findByRole("button", { name: /Multicollinearity/ }));
    const detail = screen.getByRole("region", { name: features.name });
    expect(screen.getByRole("heading", { level: 1, name: features.name })).toBeInTheDocument();
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
    await showTree();

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
    await showTree();

    const detail = await screen.findByRole("region", { name: shortlist.name });
    expect(within(detail).getByText(/every registered model that fits the task/i)).toBeInTheDocument();
    expect(within(detail).getByRole("listitem", { name: "Example 1" })).toHaveTextContent("shortlist: ml_dummy_baseline, ml_linear_model");
    expect(within(detail).queryByRole("heading", { name: "Alternatives" })).not.toBeInTheDocument();
  });

  it("marks a draft rule and shows its design notes", async () => {
    serve([features]);
    renderWithApi(<MethodologyPage />);
    await showTree();

    await userEvent.click(await within(await screen.findByRole("region", { name: "Methodology map" })).findByRole("button", { name: /Multicollinearity/ }));
    const detail = screen.getByRole("region", { name: features.name });
    expect(within(detail).getByText(/Draft: not run yet/)).toBeInTheDocument();
    expect(within(detail).getAllByText(/^When:/).length).toBeGreaterThan(0);
  });

  it("shows each file of the rule's code, read only", async () => {
    serve([split]);
    renderWithApi(<MethodologyPage />);
    await showTree();

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
    await showTree();

    await userEvent.click(await screen.findByRole("tab", { name: "Code" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("lists the rules by stage in the sidebar, each with its status on the selected flow", async () => {
    serve([features, split]);
    server.use(
      http.get("/api/pipeline_versions/:id/methodology/review", () =>
        HttpResponse.json({
          schema_version: "sprisk.methodology_review/v1",
          pipeline_version_id: "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
          items: [{ rule: split.id, decides: "split.method", stage: "split", subject_node_id: "split", status: "proposal", reason: "Keeps class shares.", recommended_alternative_id: split.alternatives[0]!.id }],
          next: [0],
        }),
      ),
    );
    useSelection.setState({ pipelineVersionId: "plv_01JABCDEFGHJKMNPQRSTVWXYZ0" });
    renderWithApi(<MethodologyPage />);
    await showTree();
    const side = await screen.findByRole("complementary", { name: "Rules" });
    expect(within(side).getByText("Split")).toBeInTheDocument();
    expect(await within(side).findByRole("button", { name: new RegExp(`${split.name}.*Proposal`) })).toBeInTheDocument();
    useSelection.setState({ pipelineVersionId: undefined });
  });

  it("shows the steps a rule decides on the selected flow under Used in", async () => {
    serve([split]);
    server.use(
      http.get("/api/pipeline_versions/:id/methodology/review", () =>
        HttpResponse.json({
          schema_version: "sprisk.methodology_review/v1",
          pipeline_version_id: "plv_01JABCDEFGHJKMNPQRSTVWXYZ0",
          items: [{ rule: split.id, decides: "split.method", stage: "split", subject_node_id: "split", status: "proposal", reason: "Keeps class shares.", recommended_alternative_id: split.alternatives[0]!.id }],
          next: [0],
        }),
      ),
    );
    useSelection.setState({ pipelineVersionId: "plv_01JABCDEFGHJKMNPQRSTVWXYZ0" });
    renderWithApi(<MethodologyPage />);
    // The fixture is a draft rule, which only the tree view lists.
    await showTree();
    await userEvent.click(await screen.findByRole("tab", { name: "Used in" }));
    expect(await screen.findByRole("list", { name: "Used in" })).toHaveTextContent(/Step split.*Proposal · Keeps class shares\./);
    useSelection.setState({ pipelineVersionId: undefined });
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
    await showTree();
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
