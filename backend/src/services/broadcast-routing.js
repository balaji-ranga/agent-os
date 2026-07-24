/**
 * Route messages to the best-matching agent(s) using this CEO's org roster
 * (agent id / name / department / role) plus shared specialty hints.
 */
const SPECIALTY_HINTS = [
  {
    id: 'social',
    pattern:
      /\b(social\s*media|social\s*assistant|facebook|instagram|linkedin|twitter|x\.com|content\s*creator|social\s*expert|content\s*post|write\s+a\s+post|marketing\s+post)\b/i,
    preferIds: ['socialasstant'],
    profileHint: /social|facebook|instagram|content|marketing|linkedin/,
  },
  {
    id: 'recipe_content',
    pattern: /\b(recipe|biryani|cuisine|cook(?:ing)?|dish|food\s+post|indian\s+thali|meal\s+plan)\b/i,
    preferIds: ['socialasstant'],
    profileHint: /social|content|recipe|cuisine|food|cook|marketing|travel|nature/,
  },
  {
    id: 'tech_research',
    pattern:
      /\b(tech\s*research|researcher|deep\s*research|research\s*expert|technology\s*research|do\s+research\s+on|aerospace|propulsion|orbital|delta-?v|space\s*flight|rocket\s+fuel|land\s+on\s+the\s+moon|moon\s+from\s+earth|to\s+the\s+moon|mars\s+mission|how\s+much\s+fuel\b.+\b(rocket|moon|space|orbit))\b/i,
    preferIds: ['techresearcher'],
    profileHint: /tech|research|analyst|science|aerospace/,
  },
  {
    id: 'expense',
    pattern: /\b(expense|finance|invoice|budget|accounting|receipts?)\b/i,
    preferIds: ['expensemanager'],
    profileHint: /expense|finance|account|budget|invoice/,
  },
  {
    id: 'job',
    pattern: /\b(job\s*discover|resume|fit\s*scor|application\s*agent|job\s*applicant|job\s*search)\b/i,
    preferIds: ['jobdiscovery', 'fitscorer', 'resumetailor', 'applicationagent'],
    profileHint: /job|resume|fit|application|career|recruit/,
  },
  {
    id: 'code',
    // Do NOT match bare "generate" / "create" — those appear in many non-code asks.
    pattern:
      /\b(code\s*assist|coding|software\s*engineer|developer|debug\s+code|write\s+code|generate\s+code|source\s*code|unit\s*tests?|github\s+checkin)\b/i,
    preferIds: ['codeassist'],
    profileHint: /code|engineer|develop|software|programming|github/,
  },
];

const PROFILE_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'agent',
  'assistant',
  'manager',
  'expert',
  'specialist',
  'team',
  'lead',
  'senior',
  'junior',
  'chief',
  'officer',
  'ops',
  'coo',
  'ceo',
  'main',
]);

/** Verbs/nouns too generic to use for org-profile scoring (caused "generate" → CodeAssist). */
const PROFILE_NOISE_WORDS = new Set([
  'generate',
  'creating',
  'create',
  'created',
  'write',
  'writing',
  'make',
  'making',
  'provide',
  'providing',
  'help',
  'helping',
  'need',
  'want',
  'please',
  'image',
  'images',
  'along',
  'using',
  'based',
  'check',
  'checkin',
  'test',
  'tests',
  'testcases',
]);

function agentHay(a) {
  return `${a.id || ''} ${a.name || ''} ${a.department || ''} ${a.role || ''}`.toLowerCase();
}

function agentMatchHint(a, hint) {
  return hint.profileHint.test(agentHay(a));
}

function pickPreferred(matched, preferIds = []) {
  if (!matched.length) return matched;
  const preferred = preferIds
    .map((id) => matched.find((a) => String(a.id).toLowerCase() === String(id).toLowerCase()))
    .filter(Boolean);
  if (preferred.length) return preferred;
  return matched;
}

/** Significant keywords derived from this org agent's id/name/department/role. */
export function orgProfileKeywords(agent) {
  const raw = `${agent?.id || ''} ${agent?.name || ''} ${agent?.department || ''} ${agent?.role || ''}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!raw) return [];
  const parts = raw
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !PROFILE_STOPWORDS.has(w) && !PROFILE_NOISE_WORDS.has(w));
  const extra = [];
  for (const w of parts) {
    if (w.length >= 8) {
      for (const piece of w.split(/(?=assist|research|manager|media|expense|discover)/)) {
        if (
          piece.length >= 4 &&
          piece !== w &&
          !PROFILE_STOPWORDS.has(piece) &&
          !PROFILE_NOISE_WORDS.has(piece)
        ) {
          extra.push(piece);
        }
      }
    }
  }
  return [...new Set([...parts, ...extra])];
}

export function listSpecialtyHints() {
  return SPECIALTY_HINTS;
}

/** True when this agent's department/role/id fits a specialty hint that the message triggers. */
export function agentFitsTriggeredSpecialty(message, agent) {
  const msg = String(message || '');
  if (!msg || !agent) return false;
  for (const hint of SPECIALTY_HINTS) {
    if (!hint.pattern.test(msg)) continue;
    if (agentMatchHint(agent, hint)) return true;
    const id = String(agent.id || '').toLowerCase();
    if (hint.preferIds.some((pid) => String(pid).toLowerCase() === id)) return true;
  }
  return false;
}

/** Score how well a message matches an agent from org metadata alone. */
export function scoreAgentOrgMatch(message, agent) {
  const msg = String(message || '').toLowerCase();
  if (!msg || !agent) return 0;
  let score = 0;
  const id = String(agent.id || '').toLowerCase();
  const name = String(agent.name || '').toLowerCase();
  if (id && new RegExp(`\\b${escapeRe(id)}\\b`, 'i').test(msg)) score += 12;
  if (name.length >= 3 && new RegExp(`\\b${escapeRe(name)}\\b`, 'i').test(msg)) score += 12;

  const msgWords = msg.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !PROFILE_NOISE_WORDS.has(w));
  const hit = new Set();
  for (const kw of orgProfileKeywords(agent)) {
    if (hit.has(kw)) continue;
    if (msg.includes(kw)) {
      hit.add(kw);
      score += kw.length >= 7 ? 4 : 3;
      continue;
    }
    const stemmed = msgWords.some(
      (w) => w.length >= 4 && kw.length >= 4 && (kw.startsWith(w) || w.startsWith(kw))
    );
    if (stemmed) {
      hit.add(kw);
      score += 2;
    }
  }

  for (const hint of SPECIALTY_HINTS) {
    if (!hint.pattern.test(msg)) continue;
    if (agentMatchHint(agent, hint)) score += 6;
    if (hint.preferIds.some((pid) => String(pid).toLowerCase() === id)) score += 3;
  }
  return score;
}

/** True when the CEO is asking someone to reach / notify them. */
export function isReachMeRequest(message) {
  const t = String(message || '');
  return /\b(reach\s+me|contact\s+me|notify\s+me|get\s*-?\s*back(\s+to\s+me)?|getback|call\s+me|ping\s+me|notify_ceo|send\s+(me\s+)?(a\s+)?notif(ication)?s?|notif(y|ication)s?\s+(me|once|when|after)|once\s+(you(?:'re| are)\s+)?ready)\b/i.test(
    t
  );
}

/**
 * Status roll-up broadcasts: every recipient should reply AND notify_ceo when done.
 * e.g. "get back on status summary and send notification once ready"
 */
export function isStatusNotifyBroadcast(message) {
  const t = String(message || '');
  const wantsStatus =
    /\b(status(\s+summary)?|standup\s+update|progress\s+update|what(?:'s| is)\s+(?:your|the)\s+status|current\s+status|update\s+me)\b/i.test(
      t
    ) || /\bget\s*-?\s*back\b|\bgetback\b/i.test(t);
  const wantsNotify =
    isReachMeRequest(t) ||
    /\b(send\s+(a\s+)?notif|notif(y|ication)|notify_ceo|ping\s+me|reach\s+me)\b/i.test(t);
  return wantsStatus && wantsNotify;
}

/**
 * Pick the best specialist(s) for a message from this CEO's agent list.
 * Uses specialty hints + optional org-profile scoring (id/name/department/role).
 *
 * @param {Array<{id:string,name?:string,department?:string,role?:string,is_coo?:number}>} agents
 * @param {string} message
 * @param {{ excludeAgentId?: string, minOrgScore?: number, enableOrgProfile?: boolean }} [opts]
 * @returns {{ agents: typeof agents, matchedSpecialty: string|null, filtered: boolean, score?: number }}
 */
export function selectBroadcastRecipients(agents, message, opts = {}) {
  const fullList = Array.isArray(agents) ? agents : [];
  const list = fullList.filter((a) => !a.is_coo);
  const exclude = String(opts.excludeAgentId || '').toLowerCase();
  const pool = exclude ? list.filter((a) => String(a.id).toLowerCase() !== exclude) : list;
  const msg = String(message || '');
  if (!pool.length) {
    // Prefer non-COO pool; never silently fan to empty → fall back to fullList only if needed.
    return { agents: list.length ? list : fullList, matchedSpecialty: null, filtered: false };
  }

  // Org-wide status + notify asks must reach every non-COO agent (not a specialty subset).
  if (isStatusNotifyBroadcast(msg)) {
    return { agents: pool, matchedSpecialty: 'status_notify_all', filtered: false };
  }

  for (const hint of SPECIALTY_HINTS) {
    if (!hint.pattern.test(msg)) continue;
    const matched = pool.filter((a) => agentMatchHint(a, hint));
    const picked = pickPreferred(matched, hint.preferIds);
    if (picked.length) {
      return { agents: picked, matchedSpecialty: hint.id, filtered: true };
    }
  }

  const byName = pool.filter((a) => {
    const id = String(a.id || '').toLowerCase();
    const name = String(a.name || '').toLowerCase();
    if (!id && !name) return false;
    const idRe = new RegExp(`\\b${escapeRe(id)}\\b`, 'i');
    const nameRe = name.length >= 3 ? new RegExp(`\\b${escapeRe(name)}\\b`, 'i') : null;
    return idRe.test(msg) || (nameRe && nameRe.test(msg));
  });
  if (byName.length) {
    return { agents: byName, matchedSpecialty: 'named', filtered: true };
  }

  if (opts.enableOrgProfile) {
    const minOrgScore = Number(opts.minOrgScore ?? 4);
    let best = null;
    let bestScore = 0;
    for (const a of pool) {
      const s = scoreAgentOrgMatch(msg, a);
      if (s > bestScore) {
        bestScore = s;
        best = a;
      }
    }
    if (best && bestScore >= minOrgScore) {
      return {
        agents: [best],
        matchedSpecialty: 'org_profile',
        filtered: true,
        score: bestScore,
      };
    }
  }

  // Default: all non-COO agents in the provided list (not COO).
  return { agents: pool, matchedSpecialty: null, filtered: false };
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Per-agent system hint appended to broadcast user content.
 */
export function buildBroadcastToolHint({
  ownerUserId,
  agent,
  reachMe,
  specialtyFiltered,
  statusNotifyAll = false,
}) {
  const name = agent.name || agent.id;
  const chatLink = `/agents/${encodeURIComponent(agent.id)}/chat`;
  if (statusNotifyAll) {
    return (
      `\n\n[Broadcast from CEO user id "${ownerUserId}"] ` +
      `The CEO wants YOUR (${name}) status summary. ` +
      `1) Write a short status summary in your reply. ` +
      `2) You MUST call **notify_ceo** when ready with title like "${name}: status ready", ` +
      `body = your summary, link_url "${chatLink}", and source_key "broadcast:${agent.id}". ` +
      `(Re-using that source_key is fine — the platform refreshes the unread bell item.) ` +
      `Do not only reply in text — the CEO is waiting on the notification bell. ` +
      `Recipient is always this CEO — never pass user_id.`
    );
  }
  if (reachMe) {
    if (specialtyFiltered) {
      return (
        `\n\n[Broadcast from CEO user id "${ownerUserId}"] ` +
        `The CEO is asking **you** (${name}) to reach them. ` +
        `You MUST call **notify_ceo** with a clear title/body and link_url "${chatLink}" ` +
        `and source_key "broadcast:${agent.id}" (do not only reply in text). ` +
        `Recipient is always this CEO — never pass user_id.`
      );
    }
    return (
      `\n\n[Broadcast from CEO user id "${ownerUserId}"] ` +
      `If — and only if — YOU (${name}) are the specialist the CEO asked for, call **notify_ceo** ` +
      `with title/body, link_url "${chatLink}", and source_key "broadcast:${agent.id}". ` +
      `If the request is for a different role/agent, reply briefly that it is not your domain and ` +
      `do **NOT** call notify_ceo.`
    );
  }
  return (
    `\n\n[Broadcast from CEO user id "${ownerUserId}"] ` +
    `Reply helpfully in this broadcast thread. Only call **notify_ceo** if the CEO explicitly asked you to reach/notify them. ` +
    `If you do call it, set source_key to "broadcast:${agent.id}" and link_url "${chatLink}". ` +
    `Do not notify for ordinary acknowledgements.`
  );
}
