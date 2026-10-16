import { ContractError, parse, type Entities } from "@sprisk/contracts";

/** All API calls go through the dev proxy (`/api` → local Rust API). */
export const API_BASE = "/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`);
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const problem = parseProblem(body);
    throw new ApiError(response.status, problem ?? `${response.status} ${response.statusText}`);
  }
  return body;
}

function parseProblem(body: unknown): string | undefined {
  try {
    return parse("Problem", body)
      .errors.map((e) => `${e.code}: ${e.message}`)
      .join("\n");
  } catch (e) {
    if (e instanceof ContractError) return undefined;
    throw e;
  }
}

/** One contract entity, validated. */
export async function getOne<K extends keyof Entities>(entity: K, path: string): Promise<Entities[K]> {
  return parse(entity, await getJson(path));
}

/** A list of contract entities, each validated. */
export async function getList<K extends keyof Entities>(entity: K, path: string): Promise<Entities[K][]> {
  const body = await getJson(path);
  if (!Array.isArray(body)) throw new ContractError(`expected a list of ${entity}`);
  return body.map((item) => parse(entity, item));
}

export async function getText(path: string): Promise<string> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw new ApiError(response.status, `${response.status} ${response.statusText}`);
  return response.text();
}

export async function postOne<K extends keyof Entities>(entity: K, path: string, body: unknown): Promise<Entities[K]> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new ApiError(response.status, parseProblem(json) ?? `${response.status} ${response.statusText}`);
  }
  return parse(entity, json);
}
