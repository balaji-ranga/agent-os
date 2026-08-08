/**
 * Run user custom scripts in an isolated subprocess with timeout.
 * Short/simple JS scripts also support in-process evaluation to avoid stdin pipe hangs under load.
 */
import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
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

async function runJsInProcess(source, inputs, context, timeoutMs) {
  const dir = mkdtempSync(join(tmpdir(), "aos-script-ip-"));
  const scriptPath = join(dir, "user-script.mjs");
  const hasDefaultExport = /\bexport\s+default\b/.test(String(source || ""));
  const wrapped = hasDefaultExport
    ? String(source || "")
    : String(source || "") + "\nexport default typeof run !== \"undefined\" ? run : undefined;\n";
  writeFileSync(scriptPath, wrapped, "utf8");
  try {
    const mod = await import(pathToFileURL(scriptPath).href + "?t=" + Date.now());
    const fn =
      typeof mod.default === "function"
        ? mod.default
        : typeof mod.run === "function"
          ? mod.run
          : typeof mod.default?.run === "function"
            ? mod.default.run
            : null;
    if (typeof fn !== "function") {
      return { ok: false, error: "Script must export run(inputs, context)" };
    }
    const result = await Promise.race([
      Promise.resolve().then(() => fn(inputs, context)),
      new Promise((_, rej) => setTimeout(() => rej(new Error("Script timeout")), timeoutMs)),
    ]);
    const out = result && typeof result === "object" ? result : { text: String(result ?? "") };
    return { ok: true, output: out };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  }
}

function runSubprocess(cmd, args, stdinPayload, timeoutMs) {
  const effectiveTimeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : ENV_TIMEOUT_MS;
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        CUSTOM_SCRIPT_TIMEOUT_MS: String(Math.min(effectiveTimeout, 60000)),
        PYTHONDONTWRITEBYTECODE: "1",
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

  // JS under 64KB: run in-process (avoids spawn/stdin hangs that stuck W1 parse/maker on VPS).
  if ((lang === "javascript" || lang === "js") && String(source || "").length < 65536) {
    return runJsInProcess(source, inputs, slimCtx, cappedTimeout);
  }

  const payload = { source, inputs, context: slimCtx, runtimeProfile };
  if (lang === "javascript" || lang === "js") {
    return runSubprocess(NODE_BIN, [SANDBOX_JS], payload, cappedTimeout);
  }
  if (lang === "python") {
    return runSubprocess(PYTHON_BIN, [SANDBOX_PY], payload, cappedTimeout);
  }
  return { ok: false, error: "Unsupported language: " + language };
}