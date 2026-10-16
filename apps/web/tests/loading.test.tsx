import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { Loading } from "../src/components/ui/Loading.tsx";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("shows nothing for a fast load, then its text after 200 ms", () => {
  render(<Loading text="Loading rows…" />);
  expect(screen.queryByText("Loading rows…")).toBeNull();
  act(() => vi.advanceTimersByTime(199));
  expect(screen.queryByText("Loading rows…")).toBeNull();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByText("Loading rows…")).toBeInTheDocument();
});
