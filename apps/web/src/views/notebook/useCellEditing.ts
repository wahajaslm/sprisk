import type { NotebookCell } from "@sprisk/contracts";
import { useEffect, useRef, useState } from "react";

import { newCellId } from "../../notebook/document.ts";

type Snapshot = { cells: NotebookCell[]; title: string; active: number };

/** A notebook's cells as the person edits them: the active cell, Markdown being edited, and
 * undo history (ADR-0035). Where the cells come from and how they run is the caller's. */
export function useCellEditing(initialCells: NotebookCell[], initialTitle: string) {
  const [cells, setCells] = useState(initialCells);
  const [title, setTitle] = useState(initialTitle);
  // Cell editors keep their own text while typing (CodeInput fit); adding, deleting or moving
  // cells remounts them so each shows its own cell's text.
  const [generation, setGeneration] = useState(0);
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState<ReadonlySet<string>>(new Set());
  const [history, setHistory] = useState<Snapshot[]>([{ cells: initialCells, title: initialTitle, active: 0 }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const cellNodes = useRef(new Map<number, HTMLDivElement>());
  const pendingD = useRef(false);
  const focusAfterRender = useRef(false);

  const pushHistory = (newCells: NotebookCell[], nextActive: number, newTitle = title) => {
    setHistory((prev) => [...prev.slice(0, historyIndex + 1), { cells: newCells, title: newTitle, active: nextActive }]);
    setHistoryIndex((prev) => prev + 1);
  };

  const goTo = (index: number) => {
    const target = history[index];
    if (!target) return;
    setHistoryIndex(index);
    setCells(target.cells);
    setTitle(target.title);
    setActive(target.active);
    setGeneration((g) => g + 1);
    focusAfterRender.current = true;
  };
  const undo = () => historyIndex > 0 && goTo(historyIndex - 1);
  const redo = () => historyIndex < history.length - 1 && goTo(historyIndex + 1);

  useEffect(() => {
    if (!focusAfterRender.current) return;
    focusAfterRender.current = false;
    cellNodes.current.get(active)?.focus();
  });

  // Built from the cells as they are now, not as this render saw them: the editor can call in
  // before its last keystrokes have re-rendered, and a stale list would drop them.
  const reshape = (change: (now: NotebookCell[]) => NotebookCell[], nextActive: number) => {
    setCells((now) => {
      const next = change(now);
      pushHistory(next, nextActive);
      return next;
    });
    setGeneration((g) => g + 1);
    setActive(nextActive);
    focusAfterRender.current = true;
  };
  const select = (index: number, { focus = false } = {}) => {
    if (index < 0 || index >= cells.length) return;
    pendingD.current = false;
    setActive(index);
    if (focus) cellNodes.current.get(index)?.focus();
  };
  const setSource = (index: number, source: string) => setCells((now) => now.map((c, i) => (i === index ? { ...c, source } : c)));
  const insert = (at: number, kind: NotebookCell["kind"]) => {
    const cell = { id: newCellId(), kind, source: "" };
    if (kind === "markdown") setEditing((now) => new Set(now).add(cell.id));
    reshape((now) => [...now.slice(0, at), cell, ...now.slice(at)], at);
  };
  /** The cells without the one at `index`, now shown; the caller saves them. */
  const removeAt = (index: number) => {
    const next = cells.filter((_, i) => i !== index);
    reshape(() => next, Math.max(0, Math.min(index, next.length - 1)));
    return next;
  };
  const setKind = (index: number, kind: NotebookCell["kind"]) => reshape((now) => now.map((c, i) => (i === index ? { ...c, kind } : c)), index);
  const stopEditing = (id: string) => setEditing((now) => new Set([...now].filter((e) => e !== id)));
  const startEditing = (id: string) => setEditing((now) => new Set(now).add(id));

  return {
    cells,
    title,
    setTitle,
    generation,
    active,
    editing,
    canUndo: historyIndex > 0,
    canRedo: historyIndex < history.length - 1,
    undo,
    redo,
    reshape,
    select,
    setSource,
    insert,
    removeAt,
    setKind,
    startEditing,
    stopEditing,
    cellNodes,
    pendingD,
  };
}

export type CellEditing = ReturnType<typeof useCellEditing>;
