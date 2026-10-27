import type { QuestionVersion } from "@sprisk/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getList, getOne, postOne } from "./client.ts";

export const useQuestionVersions = () =>
  useQuery({
    queryKey: ["question_versions"],
    queryFn: () => getList("QuestionVersion", "/question_versions?limit=100"),
  });

export const useQuestionVersion = (id: string) =>
  useQuery({
    queryKey: ["question_versions", id],
    queryFn: () => getOne("QuestionVersion", `/question_versions/${id}`),
  });

export function useSaveQuestionVersion() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (question: QuestionVersion) => postOne("QuestionVersion", "/question_versions", question),
    onSuccess: (saved) => {
      client.setQueryData<QuestionVersion[]>(["question_versions"], (versions) => [saved, ...(versions ?? [])]);
      void client.invalidateQueries({ queryKey: ["question_versions"] });
    },
  });
}
