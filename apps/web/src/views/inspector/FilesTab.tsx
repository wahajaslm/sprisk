import type { PipelineVersion } from "@sprisk/contracts";

import { useOperatorSource } from "../../api/hooks.ts";
import { useMethodFiles } from "../../api/methodology.ts";
import { useFlowDecisions } from "../../api/walks.ts";
import { Loading } from "../../components/ui/Loading.tsx";

/** The files behind a step (ADR-0063): the code it runs, then each method that shaped it,
 * its method.yaml and method.py, so a person sees which code decided and checks the step. */
export function FilesTab({ pipeline, nodeId }: { pipeline: PipelineVersion; nodeId: string }) {
  const node = pipeline.nodes.find((n) => n.id === nodeId);
  const code = useOperatorSource(node?.code === undefined ? node?.operator : undefined);
  const decided = useFlowDecisions(pipeline.id);
  if (!node) return null;
  const methods = (decided.data?.decisions ?? []).filter((d) => d.steps.includes(nodeId)).map((d) => d.method);
  return (
    <div className="files-tab">
      {node.code !== undefined && <p className="muted">This step runs its own code: see the Code tab.</p>}
      {code.isError && <p role="alert" className="error">The step's code could not be read: {code.error.message}</p>}
      {code.data && <SourceFile name={code.data.path} text={code.data.text} />}
      {decided.isError && <p role="alert" className="error">The pipeline's decisions could not be read: {decided.error.message}</p>}
      {decided.isPending && <Loading />}
      {decided.isSuccess && methods.length === 0 && <p className="muted">No method shaped this step.</p>}
      {methods.map((method) => (
        <MethodFiles key={method} method={method} />
      ))}
    </div>
  );
}

function MethodFiles({ method }: { method: string }) {
  const files = useMethodFiles(method);
  if (files.isError) return <p role="alert" className="error">{method}'s files could not be read: {files.error.message}</p>;
  if (files.isPending) return <Loading />;
  return files.data.files.map((f) => <SourceFile key={f.path} name={`${method} · ${f.path}`} text={f.text} />);
}

function SourceFile({ name, text }: { name: string; text: string }) {
  return (
    <section className="source-file" aria-label={name}>
      <p className="rd-label">{name}</p>
      <pre className="code">{text}</pre>
    </section>
  );
}
