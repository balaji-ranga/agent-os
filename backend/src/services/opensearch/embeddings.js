/**
 * OpenAI-compatible embeddings for OpenSearch knn_vector fields.
 * On failure returns null vectors so callers can skip knn and use BM25 only.
 */
const MAX_CHARS = 8000;

let warnedEmbedFailure = false;

function embeddingConfig() {
  const apiKey = String(
    process.env.OPENAI_API_KEY || process.env.OPENAI_PRIMARY_API_KEY || ''
  ).trim();
  const baseUrl = String(
    process.env.OPENAI_BASE_URL ||
      process.env.OPENAI_PRIMARY_BASE_URL ||
      process.env.OPENAI_API_URL ||
      'https://api.openai.com/v1'
  )
    .trim()
    .replace(/\/$/, '');
  const model = String(
    process.env.OPENSEARCH_EMBEDDING_MODEL || 'text-embedding-3-small'
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
  if (!apiKey) {
    if (!warnedEmbedFailure) {
      console.info(
        '[opensearch/embeddings] no API key (OPENAI_API_KEY / OPENAI_PRIMARY_API_KEY); skipping knn'
      );
      warnedEmbedFailure = true;
    }
    return list.map(() => null);
  }

  const inputs = list.map(truncateText);
  const url = `${baseUrl}/embeddings`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, input: inputs }),
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
