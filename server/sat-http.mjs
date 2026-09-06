export const FETCH_MS = 15_000;

const NET_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
]);

export function classifyNetError(err) {
  const cause = err?.cause && typeof err.cause === "object" ? err.cause : err;
  const code = String(cause?.code || err?.code || "");
  const name = String(err?.name || cause?.name || "");
  const msg = `${cause?.message || ""} ${err?.message || ""}`;
  if (name === "TimeoutError" || name === "AbortError" || code === "ABORT_ERR" || /timeout|aborted/i.test(msg)) {
    return "timeout";
  }
  if (/CERT|UNABLE_TO_VERIFY|ERR_TLS|ERR_SSL/i.test(`${code} ${msg}`)) return "tls";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || /getaddrinfo/i.test(msg)) return "dns";
  if (NET_CODES.has(code) || /fetch failed|socket hang up/i.test(msg)) return "unreachable";
  return "unreachable";
}

export function cabinetFail(url, err) {
  return {
    ok: false,
    status: 0,
    body: { error: classifyNetError(err), url: String(url || "").replace(/\/$/, "") },
  };
}

export async function cabinetRequest(url, pathname, { method = "GET", json, secret, fetchImpl = fetch, timeoutMs = FETCH_MS } = {}) {
  const base = String(url || "").replace(/\/$/, "");
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (secret) headers.Authorization = `Bearer ${secret}`;
  const signal = timeoutMs > 0 && typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
  try {
    const r = await fetchImpl(`${base}${pathname}`, {
      method,
      headers,
      body: json ? JSON.stringify(json) : undefined,
      signal,
    });
    const body = await r.json().catch(() => ({}));
    return { ok: Boolean(r.ok), status: r.status, body };
  } catch (err) {
    return cabinetFail(base, err);
  }
}

export function apiFailText(lang, out, t, fallbackKey = "pulse_fail") {
  const err = out?.body?.error;
  const url = out?.body?.url || "";
  if (err === "unreachable") return t(lang, "cabinet_down", { url });
  if (err === "timeout") return t(lang, "cabinet_timeout", { url });
  if (err === "tls") return t(lang, "cabinet_tls", { url });
  if (err === "dns") return t(lang, "cabinet_dns", { url });
  if (err === "bad_secret" || err === "not_found") return t(lang, "key_revoked");
  if (typeof err === "string" && /^[a-z][a-z0-9_]{0,40}$/.test(err)) return err;
  return t(lang, fallbackKey);
}
