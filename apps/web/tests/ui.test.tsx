import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { ListRow } from "../src/components/ui/ListRow.tsx";
import { QueryState } from "../src/components/ui/QueryState.tsx";

const query = <T,>(over: Partial<{ isPending: boolean; isError: boolean; error: Error | null; data: T }>) => ({
  isPending: false,
  isError: false,
  error: null,
  data: undefined,
  ...over,
});

it("shows a query's error as an alert", () => {
  render(<QueryState query={query({ isError: true, error: new Error("boom") })}>{() => null}</QueryState>);
  expect(screen.getByRole("alert")).toHaveTextContent("boom");
});

it("shows the empty text for an empty list, and the content otherwise", () => {
  const { rerender } = render(
    <QueryState query={query({ data: [] as string[] })} empty="Nothing yet.">
      {(items) => <p>{items.join(",")}</p>}
    </QueryState>,
  );
  expect(screen.getByText("Nothing yet.")).toBeInTheDocument();
  rerender(
    <QueryState query={query({ data: ["a", "b"] })} empty="Nothing yet.">
      {(items) => <p>{items.join(",")}</p>}
    </QueryState>,
  );
  expect(screen.getByText("a,b")).toBeInTheDocument();
});

it("renders a row as a real button with a title, its facts and a badge", () => {
  render(<ListRow title="Run 1" meta="today" badge="Running" selected onClick={() => {}} />);
  const row = screen.getByRole("button", { name: /Run 1/ });
  expect(row.tagName).toBe("BUTTON");
  expect(row).toHaveAttribute("aria-current", "true");
  expect(row).toHaveTextContent(/today.*Running/);
});

it("a page header names the page, says what it is for and holds its actions", async () => {
  const { PageHeader } = await import("../src/components/ui/PageHeader.tsx");
  render(<PageHeader eyebrow="Atlas" title="Question ledger" description="What this analysis asks." actions={<button type="button">New</button>} />);
  expect(screen.getByRole("heading", { level: 1, name: "Question ledger" })).toBeInTheDocument();
  expect(screen.getByText("What this analysis asks.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
});

it("page tabs are real tabs: the selected one is marked, and arrow keys move between them", async () => {
  const { Tabs } = await import("../src/components/ui/Tabs.tsx");
  const { default: userEvent } = await import("@testing-library/user-event");
  const { useState } = await import("react");
  function Page() {
    const [tab, setTab] = useState("card");
    return (
      <Tabs label="Model" value={tab} onChange={setTab} items={[{ value: "card", label: "Card" }, { value: "explain", label: "Explain" }]}>
        <p>Showing {tab}</p>
      </Tabs>
    );
  }
  render(<Page />);
  expect(screen.getByRole("tablist", { name: "Model" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Card" })).toHaveAttribute("aria-selected", "true");
  const panel = screen.getByRole("tabpanel");
  expect(panel).toHaveTextContent("Showing card");
  expect(screen.getByRole("tab", { name: "Card" })).toHaveAttribute("aria-controls", panel.id);

  await userEvent.click(screen.getByRole("tab", { name: "Explain" }));
  expect(screen.getByRole("tab", { name: "Explain" })).toHaveAttribute("aria-selected", "true");

  await userEvent.keyboard("{ArrowLeft}");
  expect(screen.getByRole("tab", { name: "Card" })).toHaveAttribute("aria-selected", "true");
});
