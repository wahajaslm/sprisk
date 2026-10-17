import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";

import { useRunAttempts } from "../src/api/hooks.ts";
import { useRunNodes } from "../src/api/runs.ts";
import { PV, RUN, run } from "./fixtures.ts";
import { server } from "./server.ts";

// ADR-0027 §5: the screen keeps what it shows while the same run is read again.
it("keeps a run's attempts on screen when the run finishes and they are read again", async () => {
  let status: typeof run.status = "running";
  server.use(http.get("/api/runs", () => HttpResponse.json([{ ...run, status }])));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const shown: boolean[] = [];
  const { result } = renderHook(
    () => {
      const attempts = useRunAttempts(PV, RUN);
      shown.push(attempts.data !== undefined);
      return attempts;
    },
    { wrapper },
  );
  await waitFor(() => expect(result.current.data).toBeDefined());
  const loaded = shown.length;

  status = "succeeded";
  await client.invalidateQueries({ queryKey: ["runs", PV] });
  await waitFor(() => expect(client.getQueryData(["attempts", RUN, "succeeded"])).toBeDefined());
  expect(shown.slice(loaded)).not.toContain(false);
});

it("asks for each run's outputs once, even where several steps have none yet", async () => {
  const other = { ...run, id: "run_01JABCDEFGHJKMNPQRSTVWXYZ8" };
  server.use(http.get(`/api/runs/${other.id}/attempts`, () => HttpResponse.json([])));
  const warn = vi.spyOn(console, "warn");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useRunNodes([{ ...run, status: "succeeded" }, other], ["score", "load", "nothing"]), { wrapper });

  await waitFor(() => expect(result.current[0]?.["score"]?.metrics).toEqual({ n_rows: 38, accuracy: 0.947 }));
  expect(result.current[1]).toEqual({ score: { attempts: [], metrics: undefined }, load: { attempts: [], metrics: undefined }, nothing: { attempts: [], metrics: undefined } });
  expect(warn.mock.calls.flat().join(" ")).not.toContain("Duplicate Queries");
  warn.mockRestore();
});
