import Editor, { loader, type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

import type { CodeInputProps } from "./CodeInput.tsx";

// Bundled, never fetched from a CDN: local-first means no network for the editor.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

monaco.editor.defineTheme("sprisk-studio", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "787878" },
    { token: "string", foreground: "d4d4d4" },
    { token: "keyword", foreground: "f2f2f2", fontStyle: "bold" },
    { token: "number", foreground: "a8a8a8" },
  ],
  colors: {
    "editor.background": "#0d0d0d",
    "editor.foreground": "#d4d4d4",
    "editorLineNumber.foreground": "#4f4f4f",
    "editorLineNumber.activeForeground": "#a8a8a8",
    "editor.lineHighlightBackground": "#121212",
    "editor.selectionBackground": "#2a2a2a",
    "editorCursor.foreground": "#f2f2f2",
  },
});

/** Monaco edits the code. It never runs it; running goes through the API (apps/web rules). */
export default function MonacoCode({ value, onChange, onRun, label, readOnly = false }: CodeInputProps) {
  const mount: OnMount = (editor) => {
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => onRun(editor.getValue()));
  };
  return (
    <Editor
      language="python"
      theme="sprisk-studio"
      value={value}
      onChange={(v) => onChange(v ?? "")}
      onMount={mount}
      options={{
        ariaLabel: label,
        readOnly,
        domReadOnly: readOnly,
        fontFamily: "Geist Mono Variable, ui-monospace, Menlo, monospace",
        fontSize: 12,
        lineHeight: 20,
        minimap: { enabled: false },
        bracketPairColorization: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: 4,
        automaticLayout: true,
        padding: { top: 10 },
      }}
    />
  );
}
