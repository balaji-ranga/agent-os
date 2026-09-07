/** Read-only operational audit for prompt growth and oversized chat sessions. */
import { initDb } from '../src/db/schema.js';

const db = initDb();
const days = Math.min(90, Math.max(1, Number(process.argv[2]) || 7));
const since = `-${days} days`;

const bySource = db.prepare(`
  SELECT source, COUNT(*) AS calls,
         SUM(input_tokens) AS input_tokens,
         SUM(output_tokens) AS output_tokens,
         ROUND(AVG(input_tokens)) AS avg_input_tokens,
         MAX(input_tokens) AS max_input_tokens,
         SUM(CASE WHEN tokens_estimated=1 THEN 1 ELSE 0 END) AS estimated_calls
  FROM token_usage WHERE created_at >= datetime('now', ?)
  GROUP BY source ORDER BY input_tokens DESC
`).all(since);

const largestCalls = db.prepare(`
  SELECT created_at, owner_user_id, member_key, source, model_id,
         input_tokens, output_tokens, tokens_estimated, session_id, run_id, trace_id
  FROM token_usage WHERE created_at >= datetime('now', ?)
  ORDER BY input_tokens DESC LIMIT 50
`).all(since);

const largestChats = db.prepare(`
  SELECT owner_user_id, agent_id, session_id, COUNT(*) AS turns,
         SUM(LENGTH(content)) AS chars, MAX(LENGTH(content)) AS max_turn_chars,
         MAX(created_at) AS last_at
  FROM chat_turns GROUP BY owner_user_id, agent_id, session_id
  ORDER BY chars DESC LIMIT 50
`).all();

console.log(JSON.stringify({ generated_at: new Date().toISOString(), days, by_source: bySource, largest_calls: largestCalls, largest_chats: largestChats }, null, 2));
