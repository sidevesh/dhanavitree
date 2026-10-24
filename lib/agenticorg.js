// The AgenticOrg agent's job: act as the deal desk. For every negotiation that needs the owner,
// it recommends approve / counter / reject with a draft reply; for quiet leads it drafts a follow-up.
// AgenticOrg's own HITL gate flags low-confidence calls; the owner makes the final call on the dashboard.

const BASE = (process.env.AGENTICORG_BASE_URL || "https://agenticorg.hackathon.pinelabs.com").replace(/\/$/, "");
const AGENT_ID = process.env.AGENTICORG_AGENT_ID;
const API_KEY = process.env.AGENTICORG_API_KEY; // org API key with agents.execute, if an admin issued one
const EMAIL = process.env.AGENTICORG_EMAIL; // otherwise log in as the team member
const PASSWORD = process.env.AGENTICORG_PASSWORD;

export const agenticOrgConfigured = () => Boolean(AGENT_ID && (API_KEY || (EMAIL && PASSWORD)));

let session = { token: null, expiresAt: 0 };

async function login() {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`AgenticOrg login failed (${res.status})`);
  const cookies = res.headers.getSetCookie?.() || [res.headers.get("set-cookie") || ""];
  const match = cookies.join(";").match(/agenticorg_session=([^;]+)/);
  if (!match) throw new Error("AgenticOrg login returned no session");
  session = { token: match[1], expiresAt: Date.now() + 50 * 60 * 1000 };
  return session.token;
}

async function bearer(forceLogin = false) {
  if (API_KEY) return API_KEY;
  if (forceLogin || !session.token || Date.now() > session.expiresAt) return login();
  return session.token;
}

async function runAgent(inputs, retried = false) {
  const res = await fetch(`${BASE}/api/v1/agents/${AGENT_ID}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await bearer(retried)}` },
    body: JSON.stringify({ inputs }),
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 401 && !API_KEY && !retried) return runAgent(inputs, true);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`AgenticOrg run failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

function parseOutput(output) {
  if (typeof output !== "string") return output ?? null;
  try {
    return JSON.parse(output.replace(/^```(json)?|```$/g, "").trim());
  } catch {
    return output;
  }
}

export async function runDealDesk(task, inputs) {
  if (!agenticOrgConfigured()) {
    return { ok: false, source: "not_configured", output: null, error: "AgenticOrg is not configured" };
  }
  try {
    const r = await runAgent({ task, ...inputs });
    return {
      ok: !r.error && r.status !== "failed",
      source: "agenticorg",
      run_id: r.run_id || r.task_id,
      status: r.status,
      output: parseOutput(r.output ?? r.result?.output),
      confidence: r.confidence,
      hitl_trigger: r.hitl_trigger,
      error: r.error,
    };
  } catch (err) {
    return { ok: false, source: "agenticorg_error", output: null, error: String(err.message || err) };
  }
}
