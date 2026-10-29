// Talking to the server. Every call goes through here so errors, sign-out and
// the anti-forgery header are handled in one place.

import axios from "axios";

export const apiClient = axios.create({
  baseURL: "/api/v1",
  headers: { "X-VTC": "1" },
  withCredentials: true,
});

let onSignedOut: (code: string) => void = () => {};
export function setSignedOutHandler(fn: (code: string) => void) { onSignedOut = fn; }

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export async function api(path: string, method = "GET", body: any = null, idempotencyKey: string | null = null): Promise<any> {
  const headers: Record<string, string> = { "X-VTC": "1" };
  const opts: RequestInit = { method, headers, credentials: "same-origin" };
  if (body !== null) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;
  let res: Response;
  try {
    res = await fetch("/api/v1" + path, opts);
  } catch {
    throw new ApiError("NETWORK_DOWN", 0);
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = data.error || "REQUEST_FAILED";
    if (res.status === 401 && !path.startsWith("/login")) onSignedOut(code);
    throw new ApiError(code, res.status);
  }
  return data;
}

export const newKey = (): string =>
  crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now();
