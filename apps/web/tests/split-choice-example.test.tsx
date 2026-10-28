import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SplitChoiceExample } from "../src/views/examples/SplitChoiceExample.tsx";

describe("composite split example", () => {
  it("shows the evidence-backed choice, its operator settings, and resolved notebook code", async () => {
    render(<SplitChoiceExample />);

    expect(screen.getByRole("heading", { name: "Split" })).toBeInTheDocument();
    expect(screen.getByText("Selected operator")).toBeInTheDocument();
    expect(screen.getByText("Group split", { selector: ".split-example-selected" })).toBeInTheDocument();
    expect(screen.getByLabelText("Group column")).toHaveValue("customer_id");
    expect(screen.getByLabelText("Test fraction")).toHaveValue(0.2);
    expect(screen.getByRole("link", { name: "Exploration YAML" })).toHaveAttribute(
      "href",
      "/examples/composite-split/exploration.yaml",
    );

    const notebook = await screen.findByLabelText("Resolved notebook code") as HTMLTextAreaElement;
    expect(notebook.value).toContain("def group_split(");
    expect(notebook.value).toContain('"group_column": "customer_id"');
    expect(notebook.value).not.toContain("@operator");
    expect(notebook.value).not.toContain("@method");
  });

  it("overrides the method, shows that operator's controls, and updates the notebook", async () => {
    const user = userEvent.setup();
    render(<SplitChoiceExample />);

    await user.click(screen.getByRole("button", { name: "Random" }));

    expect(screen.getByText("Random split", { selector: ".split-example-selected" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Group column")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Seed")).toHaveValue(42);
    const notebook = screen.getByLabelText("Resolved notebook code") as HTMLTextAreaElement;
    expect(notebook.value).toContain("def random_split(");
    expect(notebook.value).toContain('split_choice = "random"');
  });

  it("keeps option-specific values when choices are changed", async () => {
    const user = userEvent.setup();
    render(<SplitChoiceExample />);

    const fraction = screen.getByLabelText("Test fraction");
    await user.clear(fraction);
    await user.type(fraction, "0.3");
    await user.click(screen.getByRole("button", { name: "Temporal" }));
    await user.click(screen.getByRole("button", { name: "Group" }));

    expect(screen.getByLabelText("Test fraction")).toHaveValue(0.3);
    expect((screen.getByLabelText("Resolved notebook code") as HTMLTextAreaElement).value).toContain('"test_fraction": 0.3');
  });

  it("shows the complete decorated node source as editable code", async () => {
    const user = userEvent.setup();
    render(<SplitChoiceExample />);

    await user.click(screen.getByRole("tab", { name: "Node code" }));
    expect(screen.getByRole("link", { name: "Download split.py" })).toHaveAttribute(
      "href",
      "/examples/composite-split/split.py",
    );
    const source = screen.getByLabelText("Decorated node source");
    expect(source).not.toHaveAttribute("readonly");
    expect((source as HTMLTextAreaElement).value).toContain("@method(");
    expect((source as HTMLTextAreaElement).value).toContain("@operator(");
    expect((source as HTMLTextAreaElement).value).toContain("def temporal_split(");
  });

  it("synchronizes notebook parameters and implementation back to the node while editing", async () => {
    const user = userEvent.setup();
    render(<SplitChoiceExample />);

    const notebook = await screen.findByLabelText("Resolved notebook code") as HTMLTextAreaElement;
    const changed = notebook.value
      .replace('"test_fraction": 0.2', '"test_fraction": 0.3')
      .replace("return train, test", "return train.rechunk(), test.rechunk()");
    fireEvent.change(notebook, { target: { value: changed } });

    expect(screen.getByLabelText("Test fraction")).toHaveValue(0.3);
    expect(screen.getByText("Synced Group parameters")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Node code" }));
    expect((screen.getByLabelText("Decorated node source") as HTMLTextAreaElement).value)
      .toContain("return train.rechunk(), test.rechunk()");
  });

  it("synchronizes a notebook choice immediately", async () => {
    render(<SplitChoiceExample />);

    const notebook = await screen.findByLabelText("Resolved notebook code") as HTMLTextAreaElement;
    fireEvent.change(notebook, {
      target: { value: notebook.value.replace('split_choice = "auto"', 'split_choice = "random"') },
    });

    expect(screen.getByRole("button", { name: "Random" })).toHaveClass("active");
    expect(screen.getByText("Random split", { selector: ".split-example-selected" })).toBeInTheDocument();
    expect((screen.getByLabelText("Resolved notebook code") as HTMLTextAreaElement).value)
      .toContain("def random_split(");
  });

  it("exports the current resolved code as a plain Python notebook", async () => {
    const user = userEvent.setup();
    render(<SplitChoiceExample />);

    await user.click(screen.getByRole("button", { name: "Random" }));
    const exportLink = screen.getByRole("link", { name: "Export .ipynb" });
    const payload = decodeURIComponent(exportLink.getAttribute("href")?.split(",", 2)[1] ?? "");
    const notebook = JSON.parse(payload) as { metadata: { sprisk: { operator: string } }; cells: { source?: string[] }[] };
    expect(notebook.metadata.sprisk.operator).toBe("random_split");
    expect(notebook.cells[1]?.source?.join("")).toContain("def random_split(");
    expect(notebook.cells[1]?.source?.join("")).not.toContain("from sprisk");
  });
});
