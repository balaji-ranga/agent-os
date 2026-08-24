/**
 * Run user custom scripts outside the backend process with a bounded timeout.
 */
import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { DEFAULT_NODE_TIMEOUT_MS } from "./agent-workflow-node-timeout.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SANDBOX_JS = join(__dirname, "../../scripts/custom-script-sandbox.mjs");
const SANDBOX_PY = join(__dirname, "../../scripts/custom-script-sandbox.py");

const ENV_TIMEOUT_MS = Number(process.env.CUSTOM_SCRIPT_TIMEOUT_MS) || DEFAULT_NODE_TIMEOUT_MS;
const PYTHON_BIN = process.env.CUSTOM_SCRIPT_PYTHON || (process.platform === "win32" ? "python" : "python3");
const NODE_BIN = process.env.CUSTOM_SCRIPT_NODE || "node";
const MAX_CTX_STRING = Number(process.env.CUSTOM_SCRIPT_MAX_CONTEXT_FIELD_CHARS) || 8000;

function slimSandboxContext(context = {}) {
  if (!context || typeof context !== "object") return {};
  const outs = context.node_outputs && typeof context.node_outputs === "object" ? context.node_outputs : {};
  const slimOuts = {};
  for (const [nodeId, val] of Object.entries(outs)) {
    if (val == null || typeof val !== "object" || Array.isArray(val)) {
      slimOuts[nodeId] =
        typeof val === "string" && val.length > MAX_CTX_STRING
          ? val.slice(0, MAX_CTX_STRING) + "...[truncated]"
          : val;
      continue;
    }
    const next = {};
    for (const [k, v] of Object.entries(val)) {
      if (k === "result" || k === "body" || k === "candidates" || k === "raw") continue;
      if (typeof v === "string") {
        next[k] = v.length > MAX_CTX_STRING ? v.slice(0, MAX_CTX_STRING) + "...[truncated]" : v;
      } else if (v != null && typeof v === "object") {
        try {
          const s = JSON.stringify(v);
          next[k] = s.length > 2000 ? s.slice(0, 2000) + "...[truncated]" : v;
        } catch {
          next[k] = "[unserializable]";
        }
      } else {
        next[k] = v;
      }
    }
    slimOuts[nodeId] = next;
  }
  return {
    workflow: context.workflow ?? null,
    run_id: context.run_id ?? null,
    initial_input: String(context.initial_input || "").slice(0, 2000),
    workflow_variables: context.workflow_variables || context.variables || {},
    variables: context.variables || context.workflow_variables || {},
    node_outputs: slimOuts,
  };
}

function runSubprocess(cmd, args, stdinPayload, timeoutMs) {
  const effectiveTimeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : ENV_TIMEOUT_MS;
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
        LANG: 'C.UTF-8',
        CUSTOM_SCRIPT_TIMEOUT_MS: String(Math.min(effectiveTimeout, 60000)),
        PYTHONDONTWRITEBYTECODE: "1",
        NODE_NO_WARNINGS: '1',
      },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let killTimer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve(result);
    };
    const forceKill = () => {
      try {
        if (child.pid) child.kill("SIGKILL");
      } catch (_) {}
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch (_) {}
      killTimer = setTimeout(forceKill, 1000);
      finish({ ok: false, error: "Script timed out after " + effectiveTimeout + "ms" });
    }, effectiveTimeout + 1000);

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => finish({ ok: false, error: err.message }));
    child.on("close", (code) => {
      const line = stdout.trim().split("\n").filter(Boolean).pop() || "";
      try {
        const parsed = JSON.parse(line);
        if (parsed.ok) finish({ ok: true, output: parsed.output });
        else finish({ ok: false, error: parsed.error || stderr || "Script failed" });
      } catch {
        finish({
          ok: false,
          error: stderr.trim() || stdout.trim() || "Script exited with code " + code,
        });
      }
    });
    try {
      const raw = JSON.stringify(stdinPayload);
      if (raw.length > 500000) {
        finish({ ok: false, error: "Script context too large (" + raw.length + " bytes)" });
        forceKill();
        return;
      }
      child.stdin.end(raw);
    } catch (e) {
      finish({ ok: false, error: e.message || String(e) });
      forceKill();
    }
  });
}

async function runRemoteSandbox(payload, timeoutMs) {
  const jobsDir = String(process.env.CUSTOM_SCRIPT_RUNNER_JOBS_DIR || '').trim();
  if (!jobsDir) {
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, error: 'Custom script runner is not configured' };
    }
    return null;
  }
  if (String(payload.runtimeProfile || 'restricted').toLowerCase() === 'network') {
    return { ok: false, error: 'Network custom scripts are disabled by the hardened runner; use an API workflow node with URL policy instead' };
  }
  await mkdir(jobsDir, { recursive: true });
  const id = randomUUID();
  const tempPath = join(jobsDir, `.${id}.tmp`);
  const requestPath = join(jobsDir, `${id}.request.json`);
  const resultPath = join(jobsDir, `${id}.result.json`);
  const deadline = Date.now() + Math.min(timeoutMs, 60000) + 3000;
  try {
    await writeFile(tempPath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
    await rename(tempPath, requestPath);
    while (Date.now() < deadline) {
      try {
        const data = JSON.parse(await readFile(resultPath, 'utf8'));
        return data;
      } catch (e) {
        if (e?.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { ok: false, error: 'Custom script runner timed out' };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    for (const path of [tempPath, requestPath, resultPath]) {
      try { await unlink(path); } catch {}
    }
  }
}

export async function runCustomScriptInSandbox({
  source,
  language = "python",
  runtimeProfile = "restricted",
  inputs = {},
  context = {},
  timeoutMs,
}) {
  const lang = String(language).toLowerCase();
  const slimCtx = slimSandboxContext(context);
  const cappedTimeout =
    Number(timeoutMs) > 0
      ? Math.min(Number(timeoutMs), 60000)
      : Math.min(ENV_TIMEOUT_MS, 60000);

  const payload = { source, language: lang, inputs, context: slimCtx, runtimeProfile, timeoutMs: cappedTimeout };
  const remote = await runRemoteSandbox(payload, cappedTimeout);
  if (remote) return remote;

  // Development fallback only. Production always uses the isolated runner service.
  if (lang === "javascript" || lang === "js") {
    return runSubprocess(NODE_BIN, [SANDBOX_JS], payload, cappedTimeout);
  }
  if (lang === "python") {
    return runSubprocess(PYTHON_BIN, [SANDBOX_PY], payload, cappedTimeout);
  }
  return { ok: false, error: "Unsupported language: " + language };
}
