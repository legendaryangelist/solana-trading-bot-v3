/**
 * Thin client for the Tauric data API used by Trading-R1
 * (https://github.com/TauricResearch/Trading-R1). Base: https://api.tauric.ai/v1
 */

const DEFAULT_BASE = "https://api.tauric.ai/v1";

export type TauricJson = Record<string, unknown>;

export class TauricError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly retry: string | null;

  constructor(
    message: string,
    opts: { status: number; code?: string | null; retry?: string | null },
  ) {
    super(message);
    this.name = "TauricError";
    this.status = opts.status;
    this.code = opts.code ?? null;
    this.retry = opts.retry ?? null;
  }
}

export function requireTauricKey(): string {
  const key = process.env.TAURIC_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "TAURIC_API_KEY is not set. Create a key at https://tauric.ai/settings/api-keys, then export TAURIC_API_KEY or set the secret on the deployment.",
    );
  }
  return key;
}

export function tauricBaseUrl(): string {
  return (process.env.TAURIC_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/$/, "");
}

function queryString(params: Record<string, string | number | boolean | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

async function request(
  method: "GET" | "POST",
  path: string,
  opts?: {
    params?: Record<string, string | number | boolean | undefined | null>;
    body?: unknown;
  },
): Promise<TauricJson> {
  const key = requireTauricKey();
  const url = `${tauricBaseUrl()}${path.startsWith("/") ? path : `/${path}`}${queryString(opts?.params ?? {})}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      ...(opts?.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!res.ok) {
    const err =
      payload && typeof payload === "object" && payload !== null && "error" in payload
        ? (payload as { error?: { message?: string; code?: string; retry?: string } }).error
        : undefined;
    throw new TauricError(err?.message ?? `Tauric HTTP ${res.status}`, {
      status: res.status,
      code: err?.code ?? null,
      retry: err?.retry ?? null,
    });
  }

  return (payload ?? {}) as TauricJson;
}

export async function tauricGet(
  path: string,
  params?: Record<string, string | number | boolean | undefined | null>,
): Promise<TauricJson> {
  return request("GET", path, { params });
}

export async function tauricPost(path: string, body: unknown): Promise<TauricJson> {
  return request("POST", path, { body });
}

export function asRecord(value: unknown): TauricJson | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as TauricJson)
    : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
