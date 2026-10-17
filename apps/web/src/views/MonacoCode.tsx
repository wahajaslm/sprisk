import Editor, { loader, type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { useRef, useState } from "react";
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
    "editor.background": "#131313",
    "editorLineNumber.foreground": "#4f4f4f",
    "editorLineNumber.activeForeground": "#a8a8a8",
    "editor.lineHighlightBackground": "#121212",
    "editor.selectionBackground": "#2a2a2a",
    "editorCursor.foreground": "#f2f2f2",
  },
});

/** Monaco edits the code. It never runs it; running goes through the API (apps/web rules). */
export default function MonacoCode({ value, onChange, onRun, onRunStay, onEscape, label, readOnly = false, fit = false }: CodeInputProps) {
  const [height, setHeight] = useState<number | undefined>(undefined);
  // Bound once, at mount, so it calls the latest onRun through a ref. An action, not
  // addCommand: Monaco shares addCommand keys across editors, so with many cells on a page
  // Shift+Enter would run another cell.
  const runRef = useRef(onRun);
  runRef.current = onRun;
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;
  const stayRef = useRef(onRunStay);
  stayRef.current = onRunStay;
  const mount: OnMount = (editor) => {
    editor.addAction({
      id: "sprisk.run",
      label: "Run",
      keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.Enter],
      run: () => runRef.current(editor.getValue()),
    });
    editor.addAction({
      id: "sprisk.run-stay",
      label: "Run and stay",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => (stayRef.current ?? runRef.current)(editor.getValue()),
    });
    if (onEscape) {
      editor.addAction({
        id: "sprisk.leave",
        label: "Leave the editor",
        keybindings: [monaco.KeyCode.Escape],
        precondition: "!suggestWidgetVisible && !findWidgetVisible && !parameterHintsVisible && !inSnippetMode",
        run: () => escapeRef.current?.(),
      });
    }
    if (!fit) return;
    setHeight(editor.getContentHeight());
    editor.onDidContentSizeChange((e) => setHeight(e.contentHeight));
  };
  return (
    <Editor
      {...(fit && height !== undefined ? { height } : {})}
      language="python"
      theme="sprisk-studio"
      {...(fit ? { defaultValue: value } : { value })}
      onChange={(v) => onChange(v ?? "")}
      onMount={mount}
      options={{
        ariaLabel: label,
        readOnly,
        domReadOnly: readOnly,
        fontFamily: "'SF Mono', Menlo, Monaco, Consolas, 'Courier New', monospace",
        fontSize: 13,
        lineHeight: 20,
        minimap: { enabled: false },
        bracketPairColorization: { enabled: false },
        scrollBeyondLastLine: false,
        padding: { top: 10 },
        // A notebook cell: as tall as its code, no line numbers, long lines wrapped.
        ...(fit
          ? {
              lineNumbers: "off" as const,
              folding: false,
              glyphMargin: false,
              lineDecorationsWidth: 12,
              wordWrap: "on" as const,
              renderLineHighlight: "none" as const,
              overviewRulerLanes: 0,
              overviewRulerBorder: false,
              hideCursorInOverviewRuler: true,
              padding: { top: 10, bottom: 10 },
              scrollbar: { vertical: "hidden" as const, horizontal: "hidden" as const, alwaysConsumeMouseWheel: false },
            }
          : {}),
        tabSize: 4,
        automaticLayout: true,
      }}
    />
  );
}
