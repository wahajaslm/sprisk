/** Shown for a view type this build does not know (arch §2A proof-of-concept gate item 5). */
export function Placeholder() {
  return <p className="muted pad">This panel's view type is not available in this version.</p>;
}

/** Nav views that are not built yet say what they will show, never fake data. */
export function ComingView({ title, shows }: { title: string; shows: string }) {
  return (
    <main className="coming pad">
      <p className="eyebrow">{title}</p>
      <h1>{title}</h1>
      <p className="muted">{shows}</p>
    </main>
  );
}
