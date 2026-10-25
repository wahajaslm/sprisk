import type { Operator, PipelineVersion } from "@sprisk/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { plainCodeQuery } from "../../api/code.ts";
import { pipelineScript } from "../../notebook/script.ts";
import { codeRequest, writesPlainCode } from "../../notebook/stageCells.ts";

/** Copies the whole pipeline as one script: each writing step's plain code from the API (cached
 * like its cell's), joined in the browser. A step whose code fails to be written fails the copy. */
export function useCopyScript(pipeline: PipelineVersion, byRef: Map<string, Operator>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const writing = pipeline.nodes.filter((n) => writesPlainCode(pipeline, byRef, n.id));
      const written = await Promise.all(writing.map((n) => queryClient.fetchQuery(plainCodeQuery(n.operator, codeRequest(pipeline, byRef, n.id)))));
      const code = new Map(writing.flatMap((n, i) => (written[i] ? [[n.id, written[i]] as const] : [])));
      await navigator.clipboard.writeText(pipelineScript(pipeline, byRef, code));
    },
  });
}
