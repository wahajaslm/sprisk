import { parse, type Method, type MethodologyRule, type MethodologyRuleSource } from "@sprisk/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import bundle from "../../../contracts/bundle.schema.json";
import multicollinearity from "../../../tests/contract/methodology_rule/valid/multicollinearity.json";
import repeatedItems from "../../../tests/contract/method/valid/binds-a-concept.json";
import splitMethod from "../../../tests/contract/method/valid/split-method.json";
import { useSelection } from "../src/workbench/selection.ts";
import { dataFlow } from "../src/views/methodology/dataFlow.ts";
import { decisionFlow } from "../src/views/methodology/decisionFlow.ts";
import { MethodologyPage } from "../src/views/methodology/MethodologyPage.tsx";
import { type OnFlow, ruleTree, STAGES } from "../src/views/methodology/ruleTree.ts";
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

/** The selected flow's decisions, as a walk made them (ADR-0063). */
function decidedOnFlow(decisions: object[]) {
  server.use(
    http.get("/api/pipeline_versions/:id/decisions", ({ params }) =>
      HttpResponse.json({ schema_version: "sprisk.flow_decisions/v2", pipeline_version_id: params.id, walk_id: "wlk_01JABCDEFGHJKMNPQRSTVWXYZ0", decisions }),
    ),
  );
}

/** The split decided on the flow's split step, for `reason`. */
const splitDecided = (reason: string) => ({
  decides: split.decides,
  method: split.id,
  name: split.name,
  activity: "Fair evaluation",
  question: "How are rows divided?",
  option: split.alternatives[0]!.id,
  label: split.alternatives[0]!.label,
  reason,
  assurance: "rule",
  steps: ["split"],
  promises: [],
});

describe("methodology page", () => {
  it("shows what the selected flow's walk decided, and why", async () => {
    serve([features, split]);
    decidedOnFlow([splitDecided("Keeps each class's share the same in train and test.")]);
    useSelection.setState({ pipelineVersionId: "plv_01JABCDEFGHJKMNPQRSTVWXYZ0" });
    renderWithApi(<MethodologyPage />);
    await showTree();

    expect(await screen.findByLabelText("Pipeline decisions")).toHaveTextContent("1 decision on this pipeline.");
    const map = screen.getByRole("region", { name: "Methodology map" });
    const card = within(map).getByRole("button", { name: split.name });
    expect(within(card).getByText(/Decided/)).toBeInTheDocument();
    expect(within(within(map).getByRole("button", { name: features.name })).queryByText(/Decided/)).toBeNull();

    expect(card).not.toHaveClass("dimmed");
    await userEvent.click(screen.getByRole("switch", { name: "Pipeline path" }));
    expect(within(map).getByRole("button", { name: split.name })).not.toHaveClass("dimmed");

    await userEvent.click(card);
    const onFlow = screen.getByRole("region", { name: "On this pipeline" });
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
    const reasons = (decided: Map<string, OnFlow>) =>
      ruleTree([plain], decided, { path: false }).nodes.flatMap((n) => (n.type === "route" ? [n.data.reason] : []));

    expect(reasons(new Map())).toEqual([
      { kind: "when", text: first!.condition },
      { kind: "why", text: second!.rationale },
    ]);
    const decided: OnFlow = { option: second!.id, reason: "age and income correlate at 0.93.", step: "model" };
    expect(reasons(new Map([[plain.id, decided]]))[1]).toEqual({ kind: "because", text: "age and income correlate at 0.93." });
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
    expect(within(stages).getAllByRole("button").map((b) => b.textContent)).toEqual(["3 Data splitting1", "4 Feature engineering1"]);
    await userEvent.click(within(stages).getByRole("button", { name: /Feature engineering/ }));
    expect(within(stages).getByRole("button", { name: /Feature engineering/ })).toHaveAttribute("aria-current", "step");
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

  it("opens on the design's rule map: numbered stages, a dot per active rule, picked by a click", async () => {
    const splitting: MethodologyRule = { ...split, status: "active", question: "How should the rows be split?" };
    serve([features, splitting]);
    renderWithApi(<MethodologyPage />);
    const map = await screen.findByRole("region", { name: "Rule map" });
    expect(within(map).getByText("Data splitting")).toBeInTheDocument();
    const rule = within(map).getByRole("button", { name: new RegExp(splitting.name) });
    expect(within(map).queryByRole("button", { name: new RegExp(features.name) })).not.toBeInTheDocument();
    await userEvent.click(rule);
    expect(rule).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: splitting.name })).toHaveTextContent("Chosen on this pipeline");
  });

  it("shows the transit canvas of the active rules when asked, where a decision or a route is picked by a click", async () => {
    const splitting: MethodologyRule = { ...split, status: "active", question: "How should the rows be split?" };
    serve([features, splitting]);
    renderWithApi(<MethodologyPage />);
    await userEvent.click(await screen.findByRole("radio", { name: "Canvas" }));

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
    expect(stages).toEqual(["Problem definition", "Data preparation", "Supervised", "Data splitting", "Feature engineering"]);
    expect(within(map).getByRole("button", { name: /Data Splitting/ })).toBeInTheDocument();
  });

  it("shows what the picked rule decides, its source and its alternatives", async () => {
    serve([features, split]);
    renderWithApi(<MethodologyPage />);
    await showTree();

    await userEvent.click(await within(await screen.findByRole("region", { name: "Methodology map" })).findByRole("button", { name: /Multicollinearity/ }));
    await userEvent.click(screen.getByRole("tab", { name: "Overview" }));
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

    await userEvent.click(await screen.findByRole("tab", { name: "Overview" }));
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

    await userEvent.click(await screen.findByRole("tab", { name: "Overview" }));
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
    await userEvent.click(screen.getByRole("tab", { name: "Overview" }));
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

  it("lists the rules by stage in the sidebar, each marked when the selected flow decided it", async () => {
    serve([features, split]);
    decidedOnFlow([splitDecided("Keeps class shares.")]);
    useSelection.setState({ pipelineVersionId: "plv_01JABCDEFGHJKMNPQRSTVWXYZ0" });
    renderWithApi(<MethodologyPage />);
    await showTree();
    const side = await screen.findByRole("complementary", { name: "Rules" });
    expect(within(side).getByText("Data splitting")).toBeInTheDocument();
    expect(await within(side).findByRole("button", { name: new RegExp(`${split.name}.*Decided`) })).toBeInTheDocument();
    useSelection.setState({ pipelineVersionId: undefined });
  });

  it("shows what a method chose on the selected flow, and the steps it shaped, under Used in", async () => {
    serve([split]);
    decidedOnFlow([splitDecided("Keeps class shares.")]);
    useSelection.setState({ pipelineVersionId: "plv_01JABCDEFGHJKMNPQRSTVWXYZ0" });
    renderWithApi(<MethodologyPage />);
    // The fixture is a draft rule, which only the tree view lists.
    await showTree();
    await userEvent.click(await screen.findByRole("tab", { name: "Used in" }));
    expect(await screen.findByRole("list", { name: "Used in" })).toHaveTextContent(new RegExp(`${split.alternatives[0]!.label}Keeps class shares\\.Step split`));
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
    decidedOnFlow([splitDecided("r")]);
    renderWithApi(<MethodologyPage />);
    await showTree();
    expect(await screen.findByRole("switch", { name: "Pipeline path" })).toBeDisabled();

    useSelection.setState({ pipelineVersionId: "plv_01JABCDEFGHJKMNPQRSTVWXYZ0" });
    const pathSwitch = await screen.findByRole("switch", { name: "Pipeline path" });
    await screen.findByLabelText("Pipeline decisions");
    const map = screen.getByRole("region", { name: "Methodology map" });
    expect(within(map).getByRole("button", { name: features.name })).not.toHaveClass("dimmed");
    await userEvent.click(pathSwitch);
    expect(within(map).getByRole("button", { name: features.name })).toHaveClass("dimmed");
    expect(within(map).getByRole("button", { name: split.name })).not.toHaveClass("dimmed");
    useSelection.setState({ pipelineVersionId: undefined });
  });
});

describe("decision order", () => {
  it("shows the decisions as a flowchart in order, and the picked one's choices in a card", async () => {
    serve([multicollinearity as MethodologyRule]);
    server.use(http.get("/api/methods", () => HttpResponse.json([repeatedItems, splitMethod])));
    renderWithApi(<MethodologyPage />);
    await userEvent.click(await screen.findByRole("tab", { name: "Decision order" }));

    const canvas = await screen.findByRole("region", { name: "Decision order" });
    const split = await within(canvas).findByRole("button", { name: "Train/test split" });
    expect(split).toHaveTextContent("2");
    expect(within(canvas).getByRole("button", { name: "Duplicate analysis" })).toHaveTextContent("1");

    await userEvent.click(split);
    const card = screen.getByRole("region", { name: "Train/test split" });
    const choices = within(card).getByRole("list", { name: "Choices of Train/test split" });
    expect(within(choices).getAllByRole("listitem")).toHaveLength(splitMethod.options.length);
    expect(choices).toHaveTextContent(`If ${splitMethod.options[0]!.when}`);
    expect(within(canvas).getByRole("button", { name: splitMethod.options[0]!.label })).toHaveTextContent(splitMethod.options[0]!.condition);
    expect(choices).toHaveTextContent("→ uses group_split as the split");
    expect(within(card).getByRole("button", { name: "1. Duplicate analysis" })).toBeInTheDocument();
    expect(card).toHaveTextContent("No measurement: only the earlier decisions it waits for.");
  });

  it("says so when the methods cannot be read", async () => {
    serve([multicollinearity as MethodologyRule]);
    server.use(http.get("/api/methods", () => HttpResponse.json({ title: "packs failed" }, { status: 500 })));
    renderWithApi(<MethodologyPage />);
    await userEvent.click(await screen.findByRole("tab", { name: "Decision order" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("decision flow", () => {
  it("branches each decision into its choices, and leads every choice on to the next decision", () => {
    const flow = decisionFlow([splitMethod, repeatedItems] as Method[], "End");
    const decisions = flow.nodes.filter((n) => n.kind === "decision").map((n) => n.id);
    // Duplicate analysis is decided first: the split waits for it.
    expect(decisions).toEqual([`decision:${repeatedItems.id}`, `decision:${splitMethod.id}`]);
    for (const option of repeatedItems.options) {
      const choice = `choice:${repeatedItems.id}#${option.id}`;
      expect(flow.links).toContainEqual(expect.objectContaining({ from: decisions[0], to: choice }));
      expect(flow.links).toContainEqual(expect.objectContaining({ from: choice, to: decisions[1] }));
    }
    expect(flow.links.filter((l) => l.to === "end")).toHaveLength(splitMethod.options.length);
  });
});

describe("data flow", () => {
  // A method whose one option inserts a step before the model, changing `changes`.
  const step = (name: string, changes: Method["changes"], decisions: string[] = [], decides = `features.${name}`, action: object = { insert: { before: "model", operator: `sprisk.clean.${name}@1.0.0`, node_id: name } }) => ({
    ...repeatedItems,
    id: `methodology.core.${name}@1.0.0`,
    decides,
    name,
    ...(changes ? { changes } : {}),
    needs: { ...repeatedItems.needs, decisions },
    options: [{ ...repeatedItems.options[0]!, action }],
  });

  it("gives each kind of input its own lane, with a step changing two kinds where their lanes meet", () => {
    const flow = dataFlow([
      step("text", ["text"]),
      step("image", ["image"], ["features.text"]),
      step("rare", ["categories"]),
      step("fill", ["numbers", "categories"], ["features.rare"]),
      step("encode", ["categories"], ["features.fill"]),
      step("scale", ["numbers"], ["features.fill"]),
    ] as Method[]);
    expect(flow.lanes.map((l) => l.kind)).toEqual(["numbers", "categories", "text", "image"]);
    const at = (name: string) => flow.lanes.flatMap((l) => l.steps).find((s) => s.method.name === name)!;
    // Image is drawn beside text, not after it: it changes another lane.
    expect(at("image").column).toBe(0);
    expect(at("text").column).toBe(0);
    expect(at("rare").column).toBe(0);
    expect(at("fill")).toMatchObject({ column: 1, lanes: ["numbers", "categories"] });
    expect(at("encode").column).toBe(2);
    expect(at("scale").column).toBe(2);
    const lane = (kind: string) => flow.lanes.find((l) => l.kind === kind)!;
    expect(lane("numbers").steps.map((s) => s.method.name)).toEqual(["fill", "scale"]);
    expect(lane("categories").steps.map((s) => s.method.name)).toEqual(["rare", "fill", "encode"]);
  });

  it("draws the methods' lanes on the Data flow tab, and the picked step's card beside them", async () => {
    serve([multicollinearity as MethodologyRule]);
    const text = { ...step("text_representation", ["text"]), name: "Text representation" };
    const image = { ...step("image_features", ["image"]), name: "Image representation", applies_when: { task: ["classification"], assets: ["image"] } };
    const threshold = { ...step("decision_threshold", undefined, [], "evaluation.decision_threshold", { set: { role: "model", settings: {} } }), name: "Decision threshold" };
    server.use(http.get("/api/methods", () => HttpResponse.json([repeatedItems, splitMethod, text, image, threshold])));
    renderWithApi(<MethodologyPage />);
    await userEvent.click(await screen.findByRole("tab", { name: "Data flow" }));

    const canvas = await screen.findByRole("region", { name: "Data flow" });
    expect(within(canvas).getByText("Free text")).toBeInTheDocument();
    // Only the image lane needs files bound to the rows.
    expect(within(canvas).getAllByText(/^only with/)).toHaveLength(1);
    expect(within(canvas).getByText("only with image files")).toBeInTheDocument();
    expect(within(canvas).getByText("On its output").parentElement).toHaveTextContent("Decision threshold");
    await userEvent.click(within(canvas).getByRole("button", { name: /Text representation/ }));
    expect(screen.getByRole("region", { name: "Text representation" })).toHaveTextContent("Choices");
  });

  it("puts steps on the whole table before the split, the split, and model settings after the model", () => {
    const flow = dataFlow([
      step("join", undefined, [], "data.join", { insert: { before: "split", operator: "sprisk.io.join@1.0.0", node_id: "join" } }),
      step("threshold", undefined, [], "evaluation.threshold", { set: { role: "model", settings: {} } }),
      step("shortlist", undefined, [], "models.shortlist", { replace: { role: "model", operator: "sprisk.ml.linear_model@3.0.0" } }),
      { ...splitMethod },
      repeatedItems,
      step("text", ["text"]),
    ] as Method[]);
    expect(flow.table.map((m) => m.name)).toEqual(["join"]);
    expect(flow.split?.id).toBe(splitMethod.id);
    expect(flow.afterModel.map((m) => m.name)).toEqual(["threshold"]);
    // A method that swaps the model chooses the model itself.
    expect(flow.model.map((m) => m.name)).toEqual(["shortlist"]);
    expect(flow.table.map((m) => m.name)).toEqual(["join"]);
    // Duplicate analysis names a concept and adds no step.
    expect(flow.noStep.map((m) => m.id)).toEqual([repeatedItems.id]);
    expect(flow.lanes.map((l) => l.kind)).toEqual(["text"]);
  });
});
