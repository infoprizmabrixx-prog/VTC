// Every call to the counter server goes through here: errors, sign-out and the anti-forgery header in one place.
let onSignedOut = () => {};
export const setSignedOut = (fn) => (onSignedOut = fn);

export class ApiError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

export async function api(path, method = "GET", body = null, key = null) {
  const opts = { method, headers: { "X-VTC": "1" }, credentials: "same-origin" };
  if (body !== null) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  if (key) opts.headers["X-Idempotency-Key"] = key;
  let res;
  try { res = await fetch("/api" + path, opts); } catch { throw new ApiError("NETWORK_DOWN", 0); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = data.error || "REQUEST_FAILED";
    if (res.status === 401 && !path.startsWith("/login")) onSignedOut();
    throw new ApiError(code, res.status);
  }
  return data;
}

// crypto.randomUUID needs https; on the shop Wi-Fi (http) fall back to a random string
export const newKey = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
