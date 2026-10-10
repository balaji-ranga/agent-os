/** Rank catalog capabilities, not execution ledger IDs or untrusted result prose. */
const STOP_WORDS = new Set('a an the me my on in of for to from and with find give get latest recent please use connector action execute'.split(' '));
export function rankConnectorActions(actions, query) {
  const text = String(query || '').toLowerCase();
  const terms = [...new Set(text.match(/[a-z0-9_]+/g) || [])].filter(t => !STOP_WORDS.has(t));
  const news = /\b(news|headlines|hacker\s*news|hackernews)\b/.test(text);
  return actions.map(action => {
    const haystack = `${action.id} ${action.app_name || ''} ${action.description || ''}`.toLowerCase();
    let score = terms.reduce((sum, term) => sum + ((term.length <= 2
      ? new RegExp(`\\b${term}\\b`).test(haystack) : haystack.includes(term)) ? 2 : 0), 0);
    if (news && action.app_id === 'hackernews') {
      score += 4;
      if (/\.(get_latest_posts|search_posts)$/.test(action.id)) score += 4;
    }
    return { ...action, relevance_score: score };
  }).filter(a => !text || a.relevance_score > 0)
    .sort((a,b) => b.relevance_score - a.relevance_score || a.id.localeCompare(b.id));
}

export function connectorDiscoveryResult(actions, query, { source = 'http', limit = 30 } = {}) {
  // Do not expose raw catalog objects, connection details, or ledger IDs as capabilities.
  const ranked = rankConnectorActions(actions.filter(a => /^[a-z0-9_-]+\.[a-z0-9_.-]+$/i.test(a.id)), query);
  const selected = ranked.slice(0, limit).map(action => /^hackernews\.(get_latest_posts|search_posts)$/.test(action.id)
    ? {...action, example_input:{...action.example_input,page:0,size:20,tags:['story']}} : action);
  return {
    query, source,
    task_guidance: selected.some(a => a.app_id === 'hackernews') ? [
      'Read connector_get_action_guide before executing the chosen action. Use only schema-supported inputs.',
      'For latest Hacker News: get_latest_posts sorts by submission time. Fetch up to 20 stories per page with tags:["story"], and filter the returned titles/text for the requested topic. You may inspect up to five pages; state the bounded coverage and return fewer stories if needed.',
      'Topics such as AI or fintech are not Algolia tags. Never pass tags:["AI"] or tags:["fintech"]. Use tags:["story"] and filter topic evidence, or search_posts with a schema-supported query. Require concrete topic relevance; Airfoil and general code/security stories are not automatically AI news.',
      'search_posts is relevance/popularity search, not newest-first. Never present its top matches as the latest news without independent recency validation.',
      'created_at is the Hacker News submission date; updated_at is an index update, not the story or article publication date. Label HN submission dates explicitly. Do not claim the linked article publication date is verified.',
    ] : [],
    selection_guidance: 'Choose actions[].action_id matching the request with granted=true and available=true. Read connector_get_action_guide for inputs, then execute that exact action_id. _execution.action_id and tea-* IDs track platform executions; they are never connector actions. Do not invent IDs. Discovery does not grant permissions. If blocked, report the exact missing grant or connection.',
    actions: selected,
    apps: [...new Map(selected.map(a => [a.app_id, {id:a.app_id, name:a.app_name, available:a.available}])).values()],
    matched_count: ranked.length, truncated: ranked.length > limit,
  };
}
