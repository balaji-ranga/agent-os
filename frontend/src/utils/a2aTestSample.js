/**
 * Build a sample JSON value from a JSON Schema (client or server).
 * Prefers const / default / enum, then walks properties.
 */
export function exampleInputFromSchema(schema) {
  if (!schema || typeof schema !== 'object') return {};
  if (Object.prototype.hasOwnProperty.call(schema, 'const')) return schema.const;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (Array.isArray(schema.anyOf) && schema.anyOf.length) {
    return exampleInputFromSchema(schema.anyOf[0] || {});
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length) {
    return exampleInputFromSchema(schema.oneOf[0] || {});
  }
  const type = schema.type;
  if (type === 'object' || schema.properties) {
    const out = {};
    for (const [key, prop] of Object.entries(schema.properties || {})) {
      out[key] = exampleInputFromSchema(prop || {});
    }
    return out;
  }
  if (type === 'array') return [exampleInputFromSchema(schema.items || { type: 'string' })];
  if (type === 'integer' || type === 'number') {
    if (typeof schema.minimum === 'number') {
      return schema.exclusiveMinimum === true ? schema.minimum + 1 : schema.minimum;
    }
    if (typeof schema.exclusiveMinimum === 'number') {
      return schema.exclusiveMinimum + (type === 'integer' ? 1 : Number.EPSILON);
    }
    return type === 'integer' ? 0 : 0;
  }
  if (type === 'boolean') return false;
  if (type === 'null') return null;
  if (schema.format === 'date') return '2020-01-15';
  if (schema.format === 'date-time') return '2020-01-15T12:00:00.000Z';
  if (schema.format === 'email') return 'user@example.com';
  if (schema.format === 'uri' || schema.format === 'url') return 'https://example.com';
  return schema.description ? `sample ${schema.description}`.slice(0, 80) : 'sample';
}

export const ENQUIRE_SKILL_ID = 'enquire-progress';

export const A2A_ENQUIRE_INPUT_SAMPLE = {
  taskId: '<uuid from async accept / result.task.id>',
};

export const A2A_ENQUIRE_RESPONSE_SAMPLE = {
  jsonrpc: '2.0',
  id: '<rpc id>',
  result: {
    kind: 'message',
    messageId: '<uuid>',
    role: 'agent',
    parts: [{ kind: 'text', text: 'Workflow still running. / Final step output' }],
    task: {
      id: '<taskId>',
      status: { state: 'working | completed | failed | cancelled' },
    },
    metadata: {
      run: {
        run_id: 123,
        status: 'running | completed | failed',
        progress_pct: 40,
      },
      invoke_mode: 'async',
      run_id: 123,
    },
  },
};

/**
 * Prefer selected skill, then primary skill inputSchema / examples.
 * @param {object} agent
 * @param {string} [preferredSkillId]
 */
export function buildA2ATestSample(agent, preferredSkillId) {
  const skills = Array.isArray(agent?.agent_card?.skills) ? agent.agent_card.skills : [];
  const want = preferredSkillId || agent?.skill_id || null;
  const skill =
    (want && skills.find((s) => s?.id === want)) ||
    skills.find((s) => s?.id && s.id === agent?.skill_id) ||
    skills.find((s) => s?.id && s.id !== ENQUIRE_SKILL_ID) ||
    skills[0] ||
    null;

  if (skill?.id === ENQUIRE_SKILL_ID) {
    const schema = skill.inputSchema || skill.input_schema || null;
    return {
      skillId: ENQUIRE_SKILL_ID,
      mode: 'json',
      value: { ...A2A_ENQUIRE_INPUT_SAMPLE },
      schema,
      help:
        'Enquiry polls an async run. Paste the taskId from the async accept response (result.task.id). Optional: runId instead of taskId. Same shape as JSON-RPC tasks/get.',
    };
  }

  const schema =
    skill?.inputSchema ||
    skill?.input_schema ||
    (want && want === agent?.skill_id ? agent?.input_schema : null) ||
    (!want || want === agent?.skill_id ? agent?.input_schema : null) ||
    null;

  if (schema && typeof schema === 'object') {
    return {
      skillId: skill?.id || agent?.skill_id || 'default',
      mode: 'json',
      value: exampleInputFromSchema(schema),
      schema,
      help:
        'Primary agent skill — send this JSON (or matching text) as the message body. For async agents the first response is usually state=working with a task id; then poll enquire-progress.',
    };
  }

  const example =
    (Array.isArray(skill?.examples) && skill.examples[0]) ||
    (Array.isArray(agent?.metadata?.examples) && agent.metadata.examples[0]) ||
    `Test invoke for ${agent?.name || 'agent'}`;
  return {
    skillId: skill?.id || agent?.skill_id || 'default',
    mode: 'text',
    value: String(example),
    schema: null,
    help: 'No inputSchema on the agent card — send free-text or JSON that the workflow trigger expects.',
  };
}
