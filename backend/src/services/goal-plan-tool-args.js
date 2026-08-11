/**
 * Resolve agent_tool / self-tool body args for goal-plan execution.
 * Chat uses the agent tool-loop + full prompt reasoning; dry HTTP invoke needs
 * explicit args. This module infers params from goal text + tool purpose (heuristic
 * first, owner-aware LLM fallback) so planned tool steps behave more like chat.
 */
import { chatCompletions } from '../config/llm.js';
import { listEnabledContentTools } from './content-tools-meta.js';

/** Magnificent 7 — common CEO shorthand MAG7 / MAGS / Magnificent 7. */
export const MAG7_SYMBOLS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA'];

const TICKER_BLOCKLIST = new Set([
  'CEO',
  'COO',
  'API',
  'URL',
  'HTTP',
  'JSON',
  'USD',
  'ETF',
  'THE',
  'AND',
  'FOR',
  'WITH',
  'FROM',
  'THIS',
  'THAT',
  'USE',
  'VIA',
  'RUN',
  'GET',
  'SET',
  'POST',
  'PUT',
  'DMA',
  'SMA',
  'YTD',
  'YOY',
  'EPS',
  'LLM',
  'GPT',
  'USA',
  'UTC',
  'HTML',
  'PDF',
  'CSV',
  'SQL',
  'CRM',
  'ERP',
  'KPI',
  'KPI',
  'MAG',
  'MAGS',
  'MAG7',
  'VOOG', // keep VOOG allowed — remove from blocklist intentionally next
]);
// VOOG is a valid ticker
TICKER_BLOCKLIST.delete('VOOG');

const SYMBOL_TOOLS = new Set(['market_history', 'market_fundamentals']);

function clip(s, n = 400) {
  const t = String(s || '').trim();
  if (t.length <= n) return t;
  return t.slice(0, n - 1) + '…';
}

function parseJsonObject(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(s.slice(a, b + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Expand basket aliases in free text (MAG7, MAGS, Magnificent 7, …).
 */
export function expandMarketBaskets(text) {
  const t = String(text || '');
  if (/\bmag(?:nificent)?\s*[-_\s]?7\b|\bmags?\b|\bmag7\b/i.test(t)) {
    return [...MAG7_SYMBOLS];
  }
  return [];
}

/**
 * Heuristic ticker extraction from goal prose (parenthetical lists, $TICKER, spaced caps).
 * Not a substitute for exchange validity — execution API validates.
 */
export function extractTickersFromGoalText(text) {
  const raw = String(text || '');
  const found = [];
  const seen = new Set();

  const push = (sym) => {
    const s = String(sym || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9.]/g, '');
    // Real US equity/ETF tickers are 1–5 letters; drop 1-letter noise (e.g. "S" from S&P)
    if (!s || s.length < 2 || s.length > 6) return;
    if (s === 'SP' && /\bS\s*&\s*P\b/i.test(String(text || ''))) return;
    if (TICKER_BLOCKLIST.has(s)) return;
    if (seen.has(s)) return;
    seen.add(s);
    found.push(s);
  };

  for (const b of expandMarketBaskets(raw)) push(b);

  // Parenthetical ticker lists: (AAPL, MSFT, GOOGL, …) — require at least one comma
  const parenLists = raw.match(/\(([A-Za-z.]{1,6}(?:\s*,\s*[A-Za-z.]{1,6}){1,20})\)/g) || [];
  for (const block of parenLists) {
    const inner = block.replace(/^\(|\)$/g, '');
    for (const part of inner.split(/[,\s/;|]+/)) {
      if (/^[A-Za-z][A-Za-z0-9.]{0,5}$/.test(part.trim())) push(part);
    }
  }

  // Avoid matching "S" inside "S&P"
  const noIndex = raw.replace(/\bS\s*&\s*P(?:\s*500)?\b/gi, ' INDEX ');
  // $AAPL style
  for (const m of noIndex.matchAll(/\$([A-Za-z]{1,5})\b/g)) push(m[1]);

  // Explicit ticker: XYZ forms and VOOG-like ETFs after keywords
  for (const m of noIndex.matchAll(
    /\b(?:ticker|symbol|symbols?)\s*[:=]?\s*([A-Za-z]{1,5})\b/gi
  )) {
    push(m[1]);
  }

  // Bare likely tickers in all-caps lists (comma/space) — 3+ names
  const capsSeq = noIndex.match(/\b[A-Z]{2,5}(?:\s*,\s*[A-Z]{2,5}){2,}\b/g) || [];
  for (const seq of capsSeq) {
    for (const part of seq.split(/[,\s]+/)) push(part);
  }

  // Frequently mentioned growth ETF from this product's goals
  if (/\bVOOG\b/i.test(raw)) push('VOOG');

  return found;
}

function toolPurpose(toolName) {
  try {
    const row = listEnabledContentTools().find((t) => t.name === toolName);
    return String(row?.purpose || row?.display_name || '').trim();
  } catch {
    return '';
  }
}

function toolNeedsSymbolParam(toolName, purpose) {
  if (SYMBOL_TOOLS.has(toolName)) return true;
  const p = String(purpose || toolPurpose(toolName) || '').toLowerCase();
  return (
    /\{[\s\S]*"symbol"/.test(p) ||
    (/\bsymbol\b/.test(p) && /\b(required|body|param)/.test(p))
  );
}

function argsMissingSymbol(args) {
  const a = args && typeof args === 'object' ? args : {};
  const s = a.symbol || a.ticker || a.symbols;
  if (Array.isArray(s)) return !s.length;
  return !String(s || '').trim();
}

/**
 * LLM fill for remaining free-form tool bodies (owner BYOK / platform via chatCompletions).
 * @returns {Promise<object>}
 */
export async function llmFillToolArgs({
  ownerUserId,
  toolName,
  purpose,
  prompt,
  title,
  prior,
  baseArgs = {},
}) {
  const system =
    'You prepare the HTTP JSON body for an Agent OS content tool invoked as a goal-plan step. ' +
    'Infer parameters ONLY from the GOAL (and title / prior steps). ' +
    'Return JSON only — no markdown. Prefer exact values from the goal (tickers, email addresses, subjects). ' +
    'If the tool takes a single "symbol" but the goal lists many tickers or MAG7/MAGS/Magnificent 7, ' +
    'return {"symbols":["AAPL",...]} (uppercase) instead of one symbol. ' +
    'If only one symbol is needed and known, use {"symbol":"AAPL"}. ' +
    'Do not invent secrets. Keep keys compact.';
  const user =
    'TOOL: ' +
    toolName +
    '\nPURPOSE: ' +
    clip(purpose || toolPurpose(toolName), 500) +
    '\nTITLE: ' +
    clip(title, 200) +
    '\nGOAL:\n"""\n' +
    String(prompt || '').slice(0, 4500) +
    '\n"""\n' +
    (prior ? 'PRIOR STEPS:\n' + clip(prior, 1200) + '\n' : '') +
    'BASE_ARGS: ' +
    JSON.stringify(baseArgs || {}) +
    '\nReturn the merged body fields to pass to the tool.';

  try {
    const { content } = await chatCompletions({
      ownerUserId,
      toolName: 'goal_plan_tool_args',
      maxTokens: 600,
      temperature: 0,
      responseFormat: 'json_object',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    const parsed = parseJsonObject(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (e) {
    console.warn('[goal-plan-tool-args] LLM fill failed', toolName, e?.message || e);
  }
  return {};
}

/**
 * Whether goal prose expects a chat-style synthesis report after tools.
 */
export function goalWantsChatSynthesis(prompt) {
  const t = String(prompt || '');
  return (
    /\bsummar(y|ise|ize)\b/i.test(t) ||
    /\b(clean|brief|morning)\s+report\b/i.test(t) ||
    /\bin this chat\b/i.test(t) ||
    /\bsend (it )?to the ceo in (this )?chat\b/i.test(t) ||
    /\breply (in|with)\b/i.test(t)
  );
}

/**
 * Resolve args (+ optional multi-symbol list) before content-tool HTTP invoke.
 * @returns {Promise<{ args: object, symbols?: string[] }>}
 */
export async function resolveAgentToolArgsForGoal({
  toolName,
  args = {},
  goalPrompt = '',
  goalTitle = '',
  priorSummary = '',
  ownerUserId = null,
}) {
  const name = String(toolName || '').trim();
  let next =
    args && typeof args === 'object' && !Array.isArray(args) ? { ...args } : {};
  const purpose = toolPurpose(name);

  // Explicit multi from plan
  let symbols = [];
  if (Array.isArray(next.symbols) && next.symbols.length) {
    symbols = next.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  } else if (String(next.symbol || next.ticker || '').includes(',')) {
    symbols = String(next.symbol || next.ticker)
      .split(/[,\s;|]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }

  const needsSym = toolNeedsSymbolParam(name, purpose);

  if (needsSym && (argsMissingSymbol(next) || !symbols.length)) {
    const heuristic = extractTickersFromGoalText(
      [goalTitle, goalPrompt].filter(Boolean).join('\n')
    );
    if (heuristic.length) {
      symbols = heuristic;
      if (!next.symbol && symbols.length === 1) next.symbol = symbols[0];
      console.info('[goal-plan-tool-args] heuristic tickers', {
        tool: name,
        symbols: symbols.slice(0, 12),
      });
    }
  }

  const sparse =
    Object.keys(next).filter((k) => !['ceo_user_id', 'owner_user_id', 'force'].includes(k))
      .length === 0 ||
    (needsSym && argsMissingSymbol(next) && !symbols.length);

  if (sparse && ownerUserId) {
    const filled = await llmFillToolArgs({
      ownerUserId,
      toolName: name,
      purpose,
      prompt: goalPrompt,
      title: goalTitle,
      prior: priorSummary,
      baseArgs: next,
    });
    if (Array.isArray(filled.symbols) && filled.symbols.length) {
      symbols = filled.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
    }
    for (const [k, v] of Object.entries(filled)) {
      if (k === 'symbols') continue;
      if (next[k] == null || next[k] === '') next[k] = v;
    }
    if (symbols.length === 1 && !next.symbol) next.symbol = symbols[0];
    if (filled.symbol && !symbols.length) {
      symbols = [String(filled.symbol).trim().toUpperCase()].filter(Boolean);
    }
    console.info('[goal-plan-tool-args] LLM filled keys', {
      tool: name,
      keys: Object.keys(filled).slice(0, 12),
      symbolCount: symbols.length,
    });
  }

  if (needsSym && !symbols.length && next.symbol) {
    symbols = [String(next.symbol).trim().toUpperCase()].filter(Boolean);
  }

  // Drop multi bag before single-body calls (executor expands)
  if (symbols.length > 1) {
    delete next.symbols;
    delete next.symbol;
    delete next.ticker;
  } else if (symbols.length === 1) {
    next.symbol = symbols[0];
    delete next.symbols;
  }

  return { args: next, symbols: symbols.length ? symbols : undefined };
}
