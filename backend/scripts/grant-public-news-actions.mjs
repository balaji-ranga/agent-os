/** Explicit, owner-scoped opt-in. Never seeds news access for other tenants. */
import { initDb } from '../src/db/schema.js';
const [owner,agentId,apply]=process.argv.slice(2);
if(!owner||!agentId||apply!=='--apply') throw new Error('Usage: node scripts/grant-public-news-actions.mjs OWNER AGENT --apply');
const db=initDb();
const agent=db.prepare('SELECT id FROM agents WHERE id=? AND owner_user_id=?').get(agentId,owner);
if(!agent)throw new Error('Agent is not owned by the requested company');
if(!db.prepare("SELECT 1 FROM agent_connector_action_scopes WHERE agent_id=? AND mode='allowlist'").get(agentId))throw new Error('Explicit connector action allowlist required; refusing to change legacy scope');
const actions=['hackernews.get_latest_posts','hackernews.search_posts','hackernews.get_item'];
const result=db.transaction(()=>{
  let added=0;
  for(const id of actions){
    db.prepare("INSERT OR IGNORE INTO connector_action_registry(action_id,risk_tier,action_family,description) VALUES (?,'R0','read','Public Hacker News read; no credentials or mutations')").run(id);
    added+=db.prepare('INSERT OR IGNORE INTO agent_connector_action_grants(agent_id,action_id) VALUES (?,?)').run(agentId,id).changes;
  }
  return {owner,agent_id:agentId,added,actions};
})();
console.log(JSON.stringify(result));
db.close();
