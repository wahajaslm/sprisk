import Editor, { loader, type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

import type { CodeInputProps } from "./CodeInput.tsx";

// Bundled, never fetched from a CDN: local-first means no network for the editor.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

// VS Code Dark+ token colours (inherited from vs-dark), so code reads as it does in a notebook;
// only the editor chrome uses Studio greys.
monaco.editor.defineTheme("sprisk-studio", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#0d0d0d",
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
