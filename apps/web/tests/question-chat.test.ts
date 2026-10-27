import { parse } from "@sprisk/contracts";
import { describe, expect, it } from "vitest";

import { beforeWalk } from "../src/views/objective/ledger.ts";
import { column, rakuten } from "./fixtures.ts";
import { answer, chips, nextSlot, opening, prompt, toQuestion, type Chat } from "../src/views/objective/conversation.ts";

const start: Chat = { draft: {}, done: [] };
const pick = (chat: Chat, label: string) => {
  const chip = chips(chat, rakuten).find((c) => c.label === label);
  if (!chip) throw new Error(`no chip ${label} in ${chips(chat, rakuten).map((c) => c.label).join(", ")}`);
  const next = answer(chat, rakuten, chip.value, "confirmed");
  if (!next) throw new Error(`chip ${label} was not understood`);
  return next;
};

describe("the question conversation", () => {
  it("opens from the profile alone, naming the likely target, its classes and the text columns", () => {
    expect(opening("rakuten", rakuten)).toBe(
      "rakuten · 84,916 rows · 4 columns. prdtypecode has 27 classes. Predict it from designation and description?",
    );
    expect(chips(start, rakuten).map((c) => c.label)).toEqual(["Predict prdtypecode"]);
  });

  it("says when the total was not counted", () => {
    const { total_rows: _total, ...sample } = rakuten;
    expect(opening("big.csv", { ...sample, profiled_rows: 1000000 })).toMatch(/^big\.csv · first 1,000,000 rows · 4 columns\./);
  });

  it("asks one slot at a time, in a fixed order, and fills the ledger from chips alone", () => {
    let chat = pick(start, "Predict prdtypecode");
    expect(chat.draft.target).toEqual({ value: "prdtypecode", origin: "confirmed" });
    expect(chat.draft.objective).toEqual({ value: "Predict prdtypecode from designation and description", origin: "confirmed" });
    expect(nextSlot(chat)).toBe("task");
    expect(chips(chat, rakuten)[0]?.label).toBe("Classification");

    chat = pick(chat, "Classification");
    expect(chat.draft.task).toEqual({ value: "classification", origin: "confirmed" });
    expect(nextSlot(chat)).toBe("unit");
    chat = pick(chat, "Skip");
    expect(chat.draft.unit_of_analysis).toBeUndefined();
    expect(nextSlot(chat)).toBe("metric");
    chat = pick(chat, "Weighted F1");
    expect(nextSlot(chat)).toBe("score");
    expect(prompt(chat)).toBe("What weighted F1 counts as good enough?");
    chat = pick(chat, "0.8");
    expect(chat.draft.success_bar).toEqual({ value: { metric: "weighted_f1", score: 0.8 }, origin: "explicit" });
    chat = pick(chat, "No limit on the model");
    expect(chat.draft.interpretability).toEqual({ value: "low", origin: "explicit" });
    expect(nextSlot(chat)).toBeUndefined();

    const question = toQuestion(chat, "qv_01JABCDEFGHJKMNPQRSTVWXYZ0", "inv_01JABCDEFGHJKMNPQRSTVWXYZ0", "2026-10-27T10:00:00Z");
    expect(question).toBeDefined();
    expect(parse("QuestionVersion", question)).toEqual(question);
    expect(beforeWalk(question!)).toEqual([]);
  });

  it("reads typed answers: a sentence naming a column, a metric, a percent and a level", () => {
    let chat = answer(start, rakuten, "I want to predict the PRDTYPECODE of each listing", "explicit")!;
    expect(chat.draft.target).toEqual({ value: "prdtypecode", origin: "explicit" });
    expect(chat.draft.objective).toEqual({ value: "I want to predict the PRDTYPECODE of each listing", origin: "explicit" });
    chat = answer(chat, rakuten, "it is a category", "explicit")!;
    expect(chat.draft.task?.value).toBe("classification");
    chat = answer(chat, rakuten, "one product listing", "explicit")!;
    expect(chat.draft.unit_of_analysis).toEqual({ value: "one product listing", origin: "explicit" });
    chat = answer(chat, rakuten, "balanced accuracy please", "explicit")!;
    chat = answer(chat, rakuten, "85%", "explicit")!;
    expect(chat.draft.success_bar?.value).toEqual({ metric: "balanced_accuracy", score: 0.85 });
    chat = answer(chat, rakuten, "high", "explicit")!;
    expect(chat.draft.interpretability?.value).toBe("high");
  });

  it("does not understand what it cannot match, and never invents a target", () => {
    expect(answer(start, rakuten, "what should I predict?", "explicit")).toBeUndefined();
    let chat = pick(pick(pick(start, "Predict prdtypecode"), "Classification"), "Skip");
    expect(answer(chat, rakuten, "rmse", "explicit")).toBeUndefined();
    chat = pick(chat, "Balanced accuracy");
    expect(answer(chat, rakuten, "1.5", "explicit")).toBeUndefined();
    expect(answer(chat, rakuten, "good", "explicit")).toBeUndefined();
  });

  it("suggests regression for a measured number, compared by RMSE with no preset score", () => {
    const prices = { ...rakuten, columns: [column("rooms", "Int64", 9, "category"), column("price", "Float64", 5000, "number")] };
    expect(opening("houses.csv", prices)).toContain("rooms has 9 classes.");
    let chat = answer(start, prices, "price", "confirmed")!;
    expect(chat.draft.objective).toEqual({ value: "Predict price from the other columns", origin: "confirmed" });
    expect(chips(chat, prices)[0]?.label).toBe("Regression");
    chat = answer(chat, prices, "regression", "confirmed")!;
    chat = answer(chat, prices, "", "confirmed")!;
    expect(chips(chat, prices).map((c) => c.label)).toEqual(["RMSE"]);
    chat = answer(chat, prices, "rmse", "confirmed")!;
    expect(chips(chat, prices)).toEqual([]);
    expect(answer(chat, prices, "-2", "explicit")).toBeUndefined();
    expect(answer(chat, prices, "25000", "explicit")?.draft.success_bar?.value).toEqual({ metric: "rmse", score: 25000 });
  });
});
