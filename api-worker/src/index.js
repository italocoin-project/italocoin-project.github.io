const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data, null, 2), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra }
});
const cors = (request, env) => ({
  "access-control-allow-origin": env.CORS_ORIGIN || "https://italocoin-project.github.io",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,x-api-key",
  "vary": "Origin"
});
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
async function sha256(value) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
function randomKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "fpe_live_" + [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}
function today() { return new Date().toISOString().slice(0, 10); }
async function admin(request, env) {
  const supplied = request.headers.get("authorization") || "";
  const expected = "Bearer " + (env.ADMIN_TOKEN || "");
  if (!env.ADMIN_TOKEN || supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < supplied.length; i++) diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
async function authenticate(request, env) {
  const key = request.headers.get("x-api-key") || "";
  if (!key.startsWith("fpe_live_")) return null;
  const keyHash = await sha256(key);
  return env.DB.prepare("SELECT id,label,plan,daily_limit,active FROM api_keys WHERE key_hash=? AND active=1")
    .bind(keyHash).first();
}
async function countRequest(env, key) {
  const date = today();
  const row = await env.DB.prepare(
    "INSERT INTO usage_daily(api_key_id,usage_date,requests) VALUES(?,?,1) " +
    "ON CONFLICT(api_key_id,usage_date) DO UPDATE SET requests=requests+1 " +
    "WHERE usage_daily.requests < ? RETURNING requests"
  ).bind(key.id, date, key.daily_limit).first();
  if (!row) return null;
  await env.DB.prepare("UPDATE api_keys SET last_used_at=datetime('now') WHERE id=?").bind(key.id).run();
  return row.requests;
}
export default {
  async fetch(request, env) {
    const headers = cors(request, env);
    if (request.method === "OPTIONS") return new Response(null, { headers });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") return json({ ok: true, service: "Finance Pattern Engine API", version: "1.0.0" }, 200, headers);

      if (url.pathname.startsWith("/admin/")) {
        if (!(await admin(request, env))) return json({ error: "unauthorized" }, 401, headers);
        if (url.pathname === "/admin/keys" && request.method === "POST") {
          const body = await request.json();
          const label = String(body.label || "").trim().slice(0, 80);
          const plan = body.plan === "premium" ? "premium" : "free";
          if (!label) return json({ error: "label_required" }, 400, headers);
          const key = randomKey();
          const id = crypto.randomUUID();
          const dailyLimit = plan === "premium" ? 100000 : 1000;
          await env.DB.prepare(
            "INSERT INTO api_keys(id,label,key_hash,key_prefix,plan,daily_limit) VALUES(?,?,?,?,?,?)"
          ).bind(id, label, await sha256(key), key.slice(0, 17), plan, dailyLimit).run();
          return json({ id, label, plan, daily_limit: dailyLimit, api_key: key, warning: "Copy this key now. It is stored only as a hash and cannot be shown again." }, 201, headers);
        }
        if (url.pathname === "/admin/keys" && request.method === "GET") {
          const result = await env.DB.prepare(
            "SELECT id,label,key_prefix,plan,daily_limit,active,created_at,last_used_at FROM api_keys ORDER BY created_at DESC"
          ).all();
          return json({ keys: result.results || [] }, 200, headers);
        }
        if (url.pathname === "/admin/stats" && request.method === "GET") {
          const date = today();
          const totals = await env.DB.prepare(
            "SELECT COUNT(DISTINCT api_key_id) AS active_keys, COALESCE(SUM(requests),0) AS requests_today FROM usage_daily WHERE usage_date=?"
          ).bind(date).first();
          const byPlan = await env.DB.prepare(
            "SELECT k.plan,COALESCE(SUM(u.requests),0) AS requests FROM usage_daily u JOIN api_keys k ON k.id=u.api_key_id WHERE u.usage_date=? GROUP BY k.plan"
          ).bind(date).all();
          return json({ date, ...totals, by_plan: byPlan.results || [] }, 200, headers);
        }
        const revoke = url.pathname.match(/^\/admin\/keys\/([a-f0-9-]+)\/revoke$/);
        if (revoke && request.method === "POST") {
          const result = await env.DB.prepare("UPDATE api_keys SET active=0 WHERE id=?").bind(revoke[1]).run();
          return json({ revoked: (result.meta?.changes || 0) > 0 }, 200, headers);
        }
        return json({ error: "not_found" }, 404, headers);
      }

      if (url.pathname === "/v1/usage" && request.method === "GET") {
        const key = await authenticate(request, env);
        if (!key) return json({ error: "invalid_api_key" }, 401, headers);
        const result = await env.DB.prepare(
          "SELECT usage_date,requests FROM usage_daily WHERE api_key_id=? ORDER BY usage_date DESC LIMIT 30"
        ).bind(key.id).all();
        return json({ plan: key.plan, daily_limit: key.daily_limit, usage: result.results || [] }, 200, headers);
      }

      if (url.pathname === "/v1/coins" && request.method === "GET") {
        const key = await authenticate(request, env);
        if (!key) return json({ error: "invalid_api_key", message: "Send a valid key in the x-api-key header." }, 401, headers);
        const used = await countRequest(env, key);
        if (used === null) return json({
          error: "daily_limit_exceeded", plan: key.plan, daily_limit: key.daily_limit,
          requests_today: used, reset_at: new Date(Date.now() + (86400000 - (Date.now() % 86400000))).toISOString()
        }, 429, { ...headers, "retry-after": String(Math.max(1, Math.ceil((86400000 - (Date.now() % 86400000)) / 1000))) });
        const upstream = await fetch(env.PUBLIC_DATA_URL || "https://italocoin-project.github.io/api/v1/coins.json", {
          headers: { "accept": "application/json" },
          cf: { cacheTtl: 60, cacheEverything: true }
        });
        if (!upstream.ok) return json({ error: "upstream_unavailable" }, 502, headers);
        const data = await upstream.json();
        return json({ ...data, api: { plan: key.plan, requests_today: used, daily_limit: key.daily_limit } }, 200, {
          ...headers, "cache-control": "private, no-store", "x-ratelimit-limit": String(key.daily_limit),
          "x-ratelimit-remaining": String(Math.max(0, key.daily_limit - used))
        });
      }
      return json({ error: "not_found", docs: "https://italocoin-project.github.io/developers.html" }, 404, headers);
    } catch (error) {
      return json({ error: "internal_error", message: "The API request could not be completed." }, 500, headers);
    }
  }
};
