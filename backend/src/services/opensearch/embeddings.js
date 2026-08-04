/**
 * Embeddings for OpenSearch knn_vector fields via local Qwen (OpenAI-compatible HTTP).
 * Default: http://embeddings:8080/v1 + Qwen/Qwen3-Embedding-0.6B — no OpenAI cloud.
 * On failure returns null vectors so callers skip knn and use BM25 only.
 */
const MAX_CHARS = 8000;

let warnedEmbedFailure = false;
let loggedConfig = false;

/**
 * Prefer dedicated embedding service env; never fall back to OpenAI chat cloud keys.
 */
function embeddingConfig() {
  const baseUrl = String(
    process.env.OPENSEARCH_EMBEDDING_BASE_URL ||
      process.env.EMBEDDINGS_BASE_URL ||
      'http://embeddings:8080/v1'
  )
    .trim()
    .replace(/\/$/, '');
  const model = String(
    process.env.OPENSEARCH_EMBEDDING_MODEL ||
      process.env.EMBEDDING_MODEL_ID ||
      'Qwen/Qwen3-Embedding-0.6B'
  ).trim();
  // Local server accepts any bearer; optional so envs without a key still work.
  const apiKey = String(
    process.env.OPENSEARCH_EMBEDDING_API_KEY ||
      process.env.EMBEDDINGS_API_KEY ||
      'local'
  ).trim();
  const enabled =
    String(process.env.OPENSEARCH_EMBEDDINGS_ENABLED || '1').trim() !== '0' &&
    String(process.env.OPENSEARCH_EMBEDDINGS_ENABLED || '1').toLowerCase() !== 'false';
  return { apiKey, baseUrl, model, enabled };
}

function truncateText(text) {
  const s = String(text || '');
  if (s.length <= MAX_CHARS) return s;
  return s.slice(0, MAX_CHARS);
}

/**
 * Embed an array of texts. Returns number[] per input, or null entry on failure.
 * @param {string[]} texts
 * @returns {Promise<(number[]|null)[]>}
 */
export async function embedTexts(texts) {
  const list = Array.isArray(texts) ? texts : [];
  if (!list.length) return [];

  const { apiKey, baseUrl, model, enabled } = embeddingConfig();
  if (!enabled) {
    return list.map(() => null);
  }

  if (!loggedConfig) {
    console.info(
      '[opensearch/embeddings] provider=local base=%s model=%s',
      baseUrl,
      model
    );
    loggedConfig = true;
  }

  // Refuse accidental OpenAI cloud use (platform standard is local Qwen).
  if (/api\.openai\.com/i.test(baseUrl) || /openai\.azure/i.test(baseUrl)) {
    if (!warnedEmbedFailure) {
      console.warn(
        '[opensearch/embeddings] OpenAI cloud base URL refused; set OPENSEARCH_EMBEDDING_BASE_URL=http://embeddings:8080/v1'
      );
      warnedEmbedFailure = true;
    }
    return list.map(() => null);
  }

  const inputs = list.map(truncateText);
  const url = `${baseUrl}/embeddings`;
  const headers = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, input: inputs }),
      signal: AbortSignal.timeout(120_000),
    });
    const raw = await res.text();
    let json = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      throw new Error(`embeddings HTTP ${res.status}: ${(raw || '').slice(0, 200)}`);
    }
    const data = Array.isArray(json?.data) ? json.data : [];
    return list.map((_, i) => {
      const row = data.find((d) => d?.index === i) || data[i];
      const emb = row?.embedding;
      return Array.isArray(emb) ? emb.map(Number) : null;
    });
  } catch (e) {
    if (!warnedEmbedFailure) {
      console.warn('[opensearch/embeddings] embed failed (knn disabled):', e.message);
      warnedEmbedFailure = true;
    }
    return list.map(() => null);
  }
}
