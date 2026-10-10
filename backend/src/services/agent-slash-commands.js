// Explicit human commands. Never classify slash text with an LLM or run a shell.
export const SLASH_HELP = '/flolah skills [search] — find assigned agent skills and readiness\n/flolah skill <slug> [request] — select/prepare a skill request\n/flolah tools [search] — find granted platform tools\n/flolah tool <name> {"argument":"value"} — invoke through normal governance\n/flolah steer — list existing work\n/flolah steer <kind>:<id> <guidance> — next checkpoint, no restart\n/flolah steer status <kind>:<id> — delivery history';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export function parseAgentCommand(text) {
  let value = String(text || '').trim();
  if (value.length > 16000) fail('Command exceeds 16000 characters');
  if (/^\/flolah(?:\s|$)/i.test(value)) value = '/' + value.replace(/^\/flolah\s*/i, '');
  if (value === '/' || value === '/commands') return { kind: 'help' };
  const match = value.match(/^\/(skills|skill|tools|tool|steer)(?:\s+([\s\S]*))?$/i);
  if (!match) fail('Unknown command. Use /commands.');
  const name = match[1].toLowerCase(), args = (match[2] || '').trim();
  if (name === 'tools') return { kind: 'tools', query: args };
  if (name === 'skills') return { kind: 'skills', query: args };
  if (name === 'skill') {
    const skill = args.match(/^([a-zA-Z0-9_:-]+)(?:\s+([\s\S]*))?$/);
    if (!skill) fail('Use /flolah skills, then /flolah skill <exact slug> [request].');
    return { kind: 'skill', skill: skill[1], prompt: (skill[2] || '').trim() };
  }
  if (name === 'steer') {
    if (!args || args === 'list') return { kind: 'targets' };
    const target = args.match(/^(?:(status)\s+)?(chat|task|goal|schedule|schedule_run):([a-zA-Z0-9_-]+)(?:\s+([\s\S]+))?$/);
    if (!target) fail('Use /steer <kind>:<id> <guidance>, or /steer status <kind>:<id>.');
    if (target[1] && target[4]) fail('Status does not accept guidance.');
    if (!target[1] && !target[4]?.trim()) fail('Guidance is required; use /steer to list work.');
    return { kind: target[1] ? 'history' : 'steer', target_kind: target[2], target_id: target[3], message: target[4]?.trim() };
  }
  const tool = args.match(/^([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  if (!tool) fail('Use /tool <exact tool name> {"arguments":"values"}.');
  let params;
  if (!tool[2]?.trim()) fail('Explicit JSON arguments are required, even {}. Selecting a tool does not execute it.');
  try { params = JSON.parse(tool[2]); } catch { fail('Tool arguments must be valid JSON, not shell syntax.'); }
  if (!params || Array.isArray(params) || typeof params !== 'object') fail('Tool arguments must be a JSON object.');
  const reserved = /^(?:__proto__|constructor|prototype|owner_user_id|ownerUserId|ceo_user_id|ceoUserId|user_id|userId|caller_agent_id|__openclaw_agent_id|x_openclaw_agent_id|tool_name|toolName|approval_token)$/;
  function validate(node) {
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      if (reserved.test(key)) fail(`Argument ${key} is reserved for trusted platform context.`);
      validate(child);
    }
  }
  validate(params);
  return { kind: 'tool', tool_name: tool[1], params };
}

export function createAgentCommandRunner({ tools, skills = () => [], targets, history, enqueue, invoke }) {
  return async ({ text, ownerUserId, actor, agentId, idempotencyKey }) => {
    if (!ownerUserId || !actor?.id || !agentId) fail('Authenticated owner, actor and agent required', 403);
    const command = parseAgentCommand(text);
    if (command.kind === 'help') return { reply: SLASH_HELP, route: 'slash_help' };
    if (command.kind === 'skills') {
      const matches = skills(ownerUserId, agentId).filter(s => `${s.slug} ${s.name} ${s.description}`.toLowerCase().includes(command.query.toLowerCase()));
      return { route: 'slash_skills', skills: matches, reply: `${matches.length} enabled assigned skills:\n` + matches.map(s => `${s.slug}@v${s.version} — ${s.name} — ${s.ready ? 'ready' : `blocked: ${s.missing.join(', ')}`}\n${s.description}\n/flolah skill ${s.slug}`).join('\n\n') + '\nSkills are procedures, not tool permissions. Selection prepares a request; it does not start work.' };
    }
    if (command.kind === 'skill') {
      const available = skills(ownerUserId, agentId).filter(s => s.slug === command.skill || s.skill_id === command.skill);
      if (available.length !== 1) fail('Exact enabled assigned skill not found. Use /flolah skills.', 404);
      const skill = available[0];
      if (!skill.ready) fail(`Skill is not ready: ${skill.missing.join(', ')}. No work was started.`, 409);
      return { route: 'slash_skill_prepare', skill, prompt: command.prompt, skill_refs: [skill.skill_id],
        reply: `Selected ${skill.name} (${skill.slug}@v${skill.version}) for a new request; no work started.\nUI: use “Use skill in chat”, then send your request.\nWhatsApp: send /skill ${skill.slug} ${command.prompt || '<your request>'}\nTo guide existing work instead: /flolah steer <kind>:<id> Use assigned skill ${skill.slug}@v${skill.version} for the remaining work. Skills never grant extra tools or override approvals.` };
    }
    if (command.kind === 'tools') {
      const available = tools(ownerUserId, agentId);
      const query = command.query.toLowerCase();
      const matches = available.filter(t => `${t.name} ${t.display_name} ${t.purpose}`.toLowerCase().includes(query));
      const shown = matches.slice(0, 40);
      return { route: 'slash_catalog', tools: shown, count: matches.length, reply: `${matches.length} granted platform tools${matches.length > shown.length ? ' (first 40; add a search term)' : ''}:\n${shown.map(t => `${t.name} — ${String(t.purpose || t.display_name || '').slice(0, 130)}`).join('\n')}\nUse /tool <name> {JSON arguments}. Native shell/gateway commands are not platform tools.` };
    }
    // Exact selected agent, not whichever unrelated job happens to be newest.
    if (command.kind === 'targets') {
      const work = targets(ownerUserId, agentId);
      return { route: 'slash_steer_list', targets: work, reply: work.length ? work.map(t => `${t.kind}:${t.id} — ${t.title}\n${t.delivery}`).join('\n\n') + '\n\n/flolah steer <kind>:<id> <guidance>' : 'No active platform work for this agent. Send a normal follow-up; steering never starts work.' };
    }
    if (command.kind === 'history') {
      const notes = history(ownerUserId, command.target_kind, command.target_id, agentId);
      return { route: 'slash_steer_status', notes, reply: 'Guidance delivery history (delivered does not mean applied):\n' + (notes.map(n => `${n.status} · ${n.checkpoint || 'awaiting checkpoint'} · ${n.message}`).join('\n\n') || 'No guidance recorded for this target.') };
    }
    if (command.kind === 'steer') {
      const work = targets(ownerUserId, agentId);
      if (!work.some(t => t.kind === command.target_kind && t.id === command.target_id)) fail('Exact active work not found for this agent. Use /steer.', 409);
      const note = enqueue(ownerUserId, actor.id, { ...command, idempotency_key: idempotencyKey });
      return { route: 'slash_steer_queued', note, reply: `Guidance queued for ${command.target_kind}:${command.target_id}. Current work continues without restart. Delivery at the next checkpoint; application is unverified.` };
    }
    if (!tools(ownerUserId, agentId).some(t => t.name === command.tool_name)) fail('Tool is disabled, unavailable or not granted to this agent. Use /tools.', 403);
    return { route: 'slash_tool', ...(await invoke({ ...command, ownerUserId, actor, agentId, idempotencyKey })) };
  };
}
