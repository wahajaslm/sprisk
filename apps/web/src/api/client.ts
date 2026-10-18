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

/** A link that downloads an artifact as a file; the browser never loads it into the page. */
export const artifactDownloadUrl = (artifactId: string) => `${API_BASE}/artifacts/${artifactId}/content?download=true`;

/** One fetch for every call: a failed response becomes an ApiError with the Problem text. */
async function request(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (response.ok) return response;
  const body: unknown = await response.json().catch(() => undefined);
  throw new ApiError(response.status, problemText(body) ?? `${response.status} ${response.statusText}`);
}

function problemText(body: unknown): string | undefined {
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
  return parse(entity, await (await request(path)).json());
}

/** A list of contract entities, each validated. */
export async function getList<K extends keyof Entities>(entity: K, path: string): Promise<Entities[K][]> {
  const body: unknown = await (await request(path)).json();
  if (!Array.isArray(body)) throw new ContractError(`expected a list of ${entity}`);
  return body.map((item) => parse(entity, item));
}

export async function getText(path: string): Promise<string> {
  return (await request(path)).text();
}

export async function postOne<K extends keyof Entities>(entity: K, path: string, body: unknown): Promise<Entities[K]> {
  const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  return parse(entity, await (await request(path, init)).json());
}

/** A POST answered with no body (204), e.g. interrupt a kernel. */
export async function postEmpty(path: string): Promise<void> {
  await request(path, { method: "POST" });
}
