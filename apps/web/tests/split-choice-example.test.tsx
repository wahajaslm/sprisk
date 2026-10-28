import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SplitChoiceExample } from "../src/views/examples/SplitChoiceExample.tsx";

const cell = (label: string) => screen.getByLabelText(label) as HTMLTextAreaElement;

describe("decorator split example", () => {
  it("shows the method's own choice, reason, bound column and promise", async () => {
    render(<SplitChoiceExample />);

    expect(screen.getByText("Group split", { selector: ".split-example-selected" })).toBeInTheDocument();
    expect(screen.getByText("Chosen by the method")).toBeInTheDocument();
    expect(screen.getByText("title_id")).toBeInTheDocument();
    expect(screen.getByText(/Rows of one item stay on one side/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Promises" })).toHaveTextContent("No item has rows in both train and test.");

    const split = await screen.findByLabelText("Split cell") as HTMLTextAreaElement;
    expect(split.value).toContain("def group_split(");
    expect(split.value).toContain('group_split(data, group_column="title_id", test_fraction=0.2, seed=42)');
    expect(split.value).not.toMatch(/sprisk|@operator|ItemIdentity|TestFraction/);
    expect(await screen.findByRole("img", { name: "Rows in train and test" })).toBeInTheDocument();
  });

  it("overrides the method and says what auto would pick", async () => {
    const user = userEvent.setup();
    render(<SplitChoiceExample />);

    await user.click(screen.getByRole("button", { name: "Random" }));

    expect(screen.getByText("Random split", { selector: ".split-example-selected" })).toBeInTheDocument();
    expect(screen.getByText("Chosen by you")).toBeInTheDocument();
    expect(screen.getByText(/Auto would pick Group split/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Promises" })).toHaveTextContent("No test row has the same features as a train row.");
    expect((await screen.findByLabelText("Split cell") as HTMLTextAreaElement).value)
      .toContain("random_split(data, test_fraction=0.2, seed=42)");
  });

  it("refuses to pretend a split runs when its concept is not bound", async () => {
    const user = userEvent.setup();
    render(<SplitChoiceExample />);

    await user.click(screen.getByRole("button", { name: "Temporal" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Temporal split needs common.event_time, which this project has not bound.");
    expect(screen.queryByRole("img", { name: "Rows in train and test" })).not.toBeInTheDocument();
    expect(screen.getByText(/No chart: the split cannot run/)).toBeInTheDocument();
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

    expect(screen.getByText(/Custom code. The promises are still checked/)).toBeInTheDocument();
  });

  it("lists the files a person writes apart from the YAML Rust reads", async () => {
    const user = userEvent.setup();
    render(<SplitChoiceExample />);

    await user.click(screen.getByRole("tab", { name: "Pack files" }));
    expect((await screen.findByLabelText("split_method.py source") as HTMLTextAreaElement).value).toContain("@method(");

    await user.click(screen.getByRole("button", { name: "generated/split_method.yaml" }));
    const yaml = await screen.findByLabelText("generated/split_method.yaml source") as HTMLTextAreaElement;
    expect(yaml).toHaveAttribute("readonly");
    expect(yaml.value).toContain("# Generated from the decorated pack. Do not edit.");
  });

  it("exports the split and chart cells as a plain notebook", () => {
    render(<SplitChoiceExample />);

    const href = screen.getByRole("link", { name: "Export .ipynb" }).getAttribute("href") ?? "";
    const notebook = JSON.parse(decodeURIComponent(href.split(",", 2)[1] ?? "")) as { cells: { source: string[] }[] };
    expect(notebook.cells[1]?.source.join("")).toContain("def group_split(");
    expect(notebook.cells[2]?.source.join("")).toContain("def split_chart(");
  });
});
