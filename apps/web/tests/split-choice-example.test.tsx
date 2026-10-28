import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SplitChoiceExample } from "../src/views/examples/SplitChoiceExample.tsx";

const cell = (label: string) => screen.getByLabelText(label) as HTMLTextAreaElement;

describe("decorator split example", () => {
  it("shows the decision, why, implementation, verified evidence and plot on the node", async () => {
    render(<SplitChoiceExample />);

    const node = screen.getByRole("article", { name: "Split node" });
    expect(within(node).getByText("Keep each item's rows on one side", { selector: ".split-example-decision" })).toBeInTheDocument();
    expect(within(node).getByText(/Rows of one item stay on one side\./)).toBeInTheDocument();
    expect(within(node).getByText("common.item_identity → title_id")).toBeInTheDocument();
    expect(within(node).getByText("Group split", { selector: ".split-example-selected" })).toBeInTheDocument();
    const checks = within(node).getByRole("list", { name: "Verification" });
    expect(checks).toHaveTextContent("✓ No item has rows in both train and test.");
    expect(checks).toHaveTextContent("overlapping items 0 · train items 80 · test items 21");
    expect(within(node).getByText(/Decided from task=classification, item_identity=title_id, target=product_type · code [0-9a-f]{12}/)).toBeInTheDocument();
    expect(await within(node).findByRole("img", { name: "Items in train and test" })).toBeInTheDocument();
  });

  it("shows the split and its plot as plain Python cells", async () => {
    render(<SplitChoiceExample />);

    const split = await screen.findByLabelText("Split cell") as HTMLTextAreaElement;
    expect(split.value).toContain("def group_split(");
    expect(split.value).toContain('train, test = group_split(data, group_column="title_id", test_fraction=0.2, seed=42)');
    expect(split.value).not.toMatch(/sprisk|@operator|@promise/);

    const plot = await screen.findByLabelText("Items in train and test cell") as HTMLTextAreaElement;
    expect(plot.value).toContain("def items_per_side(");
    expect(plot.value).toContain('figure = items_per_side(train, test, group_column="title_id")');
  });

  it("swaps operator, promise and plot together on an override", async () => {
    const user = userEvent.setup();
    render(<SplitChoiceExample />);

    await user.click(screen.getByRole("button", { name: "Random" }));

    const node = screen.getByRole("article", { name: "Split node" });
    expect(within(node).getByText("Random split", { selector: ".split-example-selected" })).toBeInTheDocument();
    expect(within(node).getByText("Chosen by you")).toBeInTheDocument();
    expect(within(node).getByText(/The method would pick: Keep each item's rows on one side\./)).toBeInTheDocument();
    expect(within(node).getByText("Random rows", { selector: ".split-example-decision" })).toBeInTheDocument();
    expect(within(node).getByRole("list", { name: "Verification" })).toHaveTextContent("✓ No test row has the same features as a train row.");
    expect(within(node).queryByText(/Decided from/)).not.toBeInTheDocument();
    expect(await within(node).findByRole("img", { name: "Rows in train and test" })).toBeInTheDocument();
    expect((await screen.findByLabelText("Split cell") as HTMLTextAreaElement).value)
      .toContain("train, test = random_split(data, test_fraction=0.2, seed=42)");
  });

  it("refuses to pretend a split runs when its column is not bound", async () => {
    const user = userEvent.setup();
    render(<SplitChoiceExample />);

    await user.click(screen.getByRole("button", { name: "Temporal" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Temporal split needs common.event_time, which this project has not bound.");
    expect(screen.queryByRole("img", { name: "Rows over time, with the cutoff" })).not.toBeInTheDocument();
    expect(screen.getAllByText("No plot: common.event_time is not bound.").length).toBeGreaterThan(0);
    expect(screen.getByRole("list", { name: "Verification" })).toHaveTextContent("Not checked: the split cannot run.");
  });

  it("holds back a plot that reads the target until the final score", async () => {
    const user = userEvent.setup();
    render(<SplitChoiceExample />);

    await user.click(screen.getByRole("button", { name: "Stratified" }));

    expect(screen.queryByRole("img", { name: "Class shares in train and test" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Reads the target, so it is shown with the final score.").length).toBeGreaterThan(0);
  });

  it("moves a setting from the form to the cell and from the cell to the form", async () => {
    const user = userEvent.setup();
    render(<SplitChoiceExample />);
    await screen.findByLabelText("Split cell");

    const fraction = screen.getByLabelText("test_fraction");
    await user.clear(fraction);
    await user.type(fraction, "0.3");
    expect(cell("Split cell").value).toContain("test_fraction=0.3");
    expect(screen.getByText(/Drawn at the default settings/)).toBeInTheDocument();
    expect(screen.getByText("Checked at the default settings.")).toBeInTheDocument();

    fireEvent.change(cell("Split cell"), { target: { value: cell("Split cell").value.replace("seed=42", "seed=7") } });
    expect(screen.getByLabelText("seed")).toHaveValue(7);
    expect(screen.queryByText(/Custom code/)).not.toBeInTheDocument();
  });

  it("ignores an out-of-range setting typed into the cell", async () => {
    render(<SplitChoiceExample />);
    await screen.findByLabelText("Split cell");

    fireEvent.change(cell("Split cell"), { target: { value: cell("Split cell").value.replace("test_fraction=0.2", "test_fraction=0.9") } });

    expect(screen.getByLabelText("test_fraction")).toHaveValue(0.2);
  });

  it("marks edited function code as custom", async () => {
    render(<SplitChoiceExample />);
    await screen.findByLabelText("Split cell");

    fireEvent.change(cell("Split cell"), { target: { value: cell("Split cell").value.replace("splitter = ", "splitter  = ") } });

    expect(screen.getByText(/Custom code. This example does not run or check it/)).toBeInTheDocument();
  });

  it("lists only the five files a person writes", async () => {
    const user = userEvent.setup();
    render(<SplitChoiceExample />);

    await user.click(screen.getByRole("tab", { name: "Files" }));

    const files = within(screen.getByRole("navigation", { name: "Files" })).getAllByRole("button").map((b) => b.textContent);
    expect(files).toEqual([
      "split_method.py",
      "validation/group_split.py",
      "validation/temporal_split.py",
      "validation/random_split.py",
      "validation/stratified_split.py",
    ]);
    expect((await screen.findByLabelText("split_method.py source") as HTMLTextAreaElement).value).toContain("@method(");
  });

  it("exports the split and plot cells as a plain notebook", () => {
    render(<SplitChoiceExample />);

    const href = screen.getByRole("link", { name: "Export .ipynb" }).getAttribute("href") ?? "";
    const notebook = JSON.parse(decodeURIComponent(href.split(",", 2)[1] ?? "")) as { cells: { source: string[] }[] };
    expect(notebook.cells[1]?.source.join("")).toContain("def group_split(");
    expect(notebook.cells[2]?.source.join("")).toContain("def items_per_side(");
  });
});
