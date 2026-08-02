const BASE = (process.env.BASE_URL || process.env.VPS_BASE_URL || "https://flolah.com").replace(/\/$/, "");
const API = `${BASE}/api`;

async function json(res) {
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { ok: res.ok, status: res.status, body };
}

async function login() {
  if (process.env.TOKEN) return process.env.TOKEN;
  const email = process.env.CEO_EMAIL;
  const password = process.env.CEO_PASSWORD;
  if (!email || !password) throw new Error("Set TOKEN or CEO_EMAIL + CEO_PASSWORD");
  const r = await json(await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }));
  if (!r.ok || !r.body?.token) throw new Error(`login failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token;
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function chat(token, agentId, message, timeoutMs = 240000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    console.info(`[e2e] chat -> ${agentId}: ${message.slice(0, 140)}...`);
    const r = await json(await fetch(`${API}/agents/${encodeURIComponent(agentId)}/chat`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ message }),
      signal: ctrl.signal,
    }));
    if (!r.ok) throw new Error(`chat ${agentId} ${r.status}: ${JSON.stringify(r.body).slice(0, 600)}`);
    const reply = r.body?.reply || r.body?.content || r.body?.message || "";
    console.info(`[e2e] <- ${agentId} (${String(reply).length} chars): ${String(reply).slice(0, 320)}`);
    return r.body;
  } finally {
    clearTimeout(t);
  }
}

async function getAgents(token) {
  const r = await json(await fetch(`${API}/agents`, { headers: authHeaders(token) }));
  if (!r.ok) throw new Error(`agents ${r.status}`);
  return r.body?.agents || r.body || [];
}

async function getOnboarding(token) {
  const r = await json(await fetch(`${API}/onboarding/helper`, { headers: authHeaders(token) }));
  if (!r.ok) throw new Error(`onboarding ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

async function listWorkflows(token) {
  for (const path of ["/agent-workflows?include_drafts=1", "/workflows?include_drafts=1"]) {
    const r = await json(await fetch(`${API}${path}`, { headers: authHeaders(token) }));
    if (r.ok) return r.body?.workflows || r.body || [];
  }
  return [];
}

async function main() {
  console.info("[e2e] base=", BASE);
  const token = await login();
  console.info("[e2e] logged in");

  const onboardPrompt = `Create and onboard this custom agent end-to-end now:

Department: Trading (purpose: market monitoring and alerts)
Agent: MarketWatcher — reports to COO
Role: Watch a configurable equity/crypto watchlist; when price dips by a configurable X% from recent high, alert via email_send + notify_ceo. Additive only (do not remove existing agents).

Include tools: learnings_summary, master_data_rag, notify_ceo, email_send, brave_web_search (if available).
Include MD files for MarketWatcher: MEMORY note about watchlist+threshold and a short WATCHLIST.md template.

When ready:
1) Call onboarding_save_proposal with structured departments, agents, tools, workflow notes, md_files.
2) I explicitly confirm APPLY OVERRIDE — call onboarding_apply_proposal with confirm_override=true.

Use the tools; do not only coach.`;

  await chat(token, "onboardinghelper", onboardPrompt, 300000);
  await chat(token, "onboardinghelper", "Yes — apply override now. Call onboarding_apply_proposal with confirm_override true for the MarketWatcher proposal.", 180000);

  const state = await getOnboarding(token);
  console.info("[e2e] onboarding status=", state.status, "source=", state.proposal_source, "step=", state.current_step?.id);
  console.info("[e2e] proposal agents=", (state.proposal?.agents || []).map((a) => a.name).join(", "));

  const agentsAfter = await getAgents(token);
  const mw = (Array.isArray(agentsAfter) ? agentsAfter : []).find((a) => /market.?watch/i.test(`${a.id} ${a.name}`));
  console.info("[e2e] MarketWatcher found=", !!mw, mw ? `${mw.id} (${mw.name})` : "");

  const agentRef = mw?.id || "MarketWatcher";
  const wfPrompt = `Build and publish a new workflow end-to-end (use mutate + certify tools):

Name: MarketWatcher validate loop
Goal: Trigger runs agent ${agentRef} with inputs (watchlist, dip_threshold_pct, context). Ollama brain validates agent output. On FAIL loop back to agent with brain feedback (max 3). On PASS finish.

Requirements:
1) create_workflow titled "MarketWatcher validate loop"
2) trigger with JSON inputs
3) agent node agent_id="${agentRef}" using {{trigger-1.trigger_input.*}}
4) brain modelSource="ollama" PASS/FAIL + feedback
5) if/while loop FAIL->agent, PASS->end
6) publish or certify_start / until_success

Call learnings_summary then agent_workflow_mutate. Report workflow_id.`;

  await chat(token, "workflowbuilder", wfPrompt, 420000);
  await chat(token, "workflowbuilder", "Confirm MarketWatcher validate loop exists; paste workflow_id and node summary.", 180000);

  const workflows = await listWorkflows(token);
  const hit = (Array.isArray(workflows) ? workflows : []).find((w) => /market.?watch|validate.?loop/i.test(`${w.id} ${w.name} ${w.title}`));
  console.info("[e2e] workflow hit=", !!hit, hit ? JSON.stringify({ id: hit.id, name: hit.name || hit.title, status: hit.status || hit.published }) : "");
  const okAgent = !!mw;
  const okWf = !!hit;
  console.info("[e2e] RESULT", { okAgent, okWf, agentId: mw?.id, workflowId: hit?.id });
  if (!okAgent || !okWf) process.exitCode = 2;
}

main().catch((e) => { console.error("[e2e] FATAL", e?.message || e); process.exit(1); });