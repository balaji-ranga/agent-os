/**
 * Local Ollama context for OpenClaw / platform primary.
 *
 * OpenClaw precheck: promptBudget = contextWindow - reserveTokens.
 * VPS logs (deepseek-r1:8b): estimatedPromptTokens≈19490, reserveTokens=20000,
 * so 32768 only leaves 12768 and overflows "hi". Need ≥19490+20000+headroom → 65536.
 * ollama show deepseek-r1:8b: context length 131072. Do not default to 128k on 16GB RAM.
 *
 * Catalog contextWindow (precheck) is separate from Ollama runtime num_ctx.
 * 8B @ 65k allocated 9.2GiB KV and was SIGKILL'd on a 15GiB VPS (OpenClaw 408).
 */
export const LOCAL_OLLAMA_PRIMARY_CTX_FLOOR = 65536;
export const LOCAL_OLLAMA_NATIVE_CTX_CAP = 131072;
export const LOCAL_OLLAMA_INFER_CTX_DEFAULT = 32768;

export function resolveLocalOllamaContextWindow(envValue, nativeMax) {
  const parsed = Number(envValue);
  const fromEnv =
    Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : LOCAL_OLLAMA_PRIMARY_CTX_FLOOR;
  const capParsed = Number(nativeMax);
  const cap =
    Number.isFinite(capParsed) && capParsed > 0
      ? Math.floor(capParsed)
      : LOCAL_OLLAMA_NATIVE_CTX_CAP;
  return Math.min(cap, Math.max(LOCAL_OLLAMA_PRIMARY_CTX_FLOOR, fromEnv));
}

export function resolveLocalOllamaInferCtx(envValue) {
  const parsed = Number(envValue);
  const n = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : LOCAL_OLLAMA_INFER_CTX_DEFAULT;
  return Math.min(LOCAL_OLLAMA_NATIVE_CTX_CAP, Math.max(8192, n));
}

export function resolveLocalOllamaTimeoutSeconds(envMs) {
  const parsed = Number(envMs);
  const ms = Number.isFinite(parsed) && parsed > 0 ? parsed : 600000;
  return Math.max(60, Math.ceil(ms / 1000));
}
