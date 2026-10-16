import { expect, it } from "vitest";

// ADR-0027: only src/api talks to the server, so every request goes through its paged,
// size-capped functions.
const sources = import.meta.glob<string>("../src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });

it("only src/api calls the network", () => {
  const offenders = Object.entries(sources)
    .filter(([path]) => !path.startsWith("../src/api/"))
    .filter(([, code]) => /\bfetch\(|new EventSource\(|XMLHttpRequest/.test(code))
    .map(([path]) => path);
  expect(offenders).toEqual([]);
});

it("src/api reads no UI store", () => {
  const offenders = Object.entries(sources)
    .filter(([path]) => path.startsWith("../src/api/"))
    .filter(([, code]) => /from "\.\.\/workbench\//.test(code))
    .map(([path]) => path);
  expect(offenders).toEqual([]);
});

const styles = import.meta.glob<string>("../src/**/*.css", { query: "?raw", import: "default", eager: true });

it("font sizes come from the type scale tokens", () => {
  expect(Object.keys(styles).length).toBeGreaterThan(0);
  const raw = Object.entries(styles).flatMap(([path, css]) =>
    [...css.matchAll(/font(?:-size)?:[^;]*?\b\d+(?:\.\d+)?px/g)].map((m) => `${path}: ${m[0]}`),
  );
  expect(raw).toEqual([]);
});
