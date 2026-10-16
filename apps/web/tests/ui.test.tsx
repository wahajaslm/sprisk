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

it("renders a row as a button with a title, a note and a state", () => {
  render(<ListRow title="Run 1" meta="today" state="succeeded" current onClick={() => {}} />);
  const row = screen.getByRole("button", { name: /Run 1/ });
  expect(row).toHaveAttribute("aria-current", "true");
  expect(row).toHaveTextContent(/today.*succeeded/);
});
