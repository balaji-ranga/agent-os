import assert from 'node:assert/strict';
import {
  extractCompanyDesignJson,
  hasUsableCompanyDesign,
  requestCompanyDesignJson,
} from '../src/services/company-llm-design.js';

const longRequest =
  'Design a small AI-powered team to support me as a consultant, content creator, and app builder. ' +
  'I need Strategy & Research, Video & Content Production, Marketing & Social Media, and App/Product Development. ' +
  'Include AI roles for market research, business/consulting analysis, content ideas, scriptwriting, ' +
  'video production/editing, social media management, UI/UX design, software development, testing, ' +
  'documentation, and project management. Keep the team lean, with minimal overlap between roles.';

const validDesign = {
  reply: 'Created a lean four-department team with eight complementary specialists.',
  departments: [
    { name: 'Strategy & Research', purpose: 'Market and consulting insight.' },
    { name: 'Video & Content Production', purpose: 'Ideas, scripts, and video.' },
    { name: 'Marketing & Social Media', purpose: 'Distribution and community.' },
    { name: 'App/Product Development', purpose: 'Design, build, test, and document.' },
  ],
  agents: [
    { name: 'Strategy Analyst', role: 'Market and consulting analysis', department: 'Strategy & Research' },
    { name: 'Content Strategist', role: 'Ideas and scriptwriting', department: 'Video & Content Production' },
    { name: 'Video Producer', role: 'Production and editing', department: 'Video & Content Production' },
    { name: 'Social Manager', role: 'Social media management', department: 'Marketing & Social Media' },
    { name: 'Product Designer', role: 'UI/UX design', department: 'App/Product Development' },
    { name: 'Software Engineer', role: 'Software development', department: 'App/Product Development' },
    { name: 'Quality Engineer', role: 'Testing and documentation', department: 'App/Product Development' },
    { name: 'Project Manager', role: 'Cross-team delivery', department: 'Strategy & Research' },
  ],
  workflows: [],
  channels: [],
};

assert.deepEqual(
  extractCompanyDesignJson(`Here is the result:\n\`\`\`json\n${JSON.stringify(validDesign)}\n\`\`\``),
  validDesign,
  'extracts a fenced JSON object'
);
assert.equal(hasUsableCompanyDesign(validDesign), true);
assert.equal(hasUsableCompanyDesign({ departments: [], agents: [] }), false);

const calls = [];
const result = await requestCompanyDesignJson({
  messages: [
    { role: 'system', content: 'Return an organization as JSON.' },
    { role: 'user', content: longRequest },
  ],
  maxTokens: 3200,
  ownerUserId: 'test-company-owner',
  chatFn: async (request) => {
    calls.push(request);
    return calls.length === 1
      ? { content: '{"departments":[', modelUsed: 'test-model' }
      : { content: JSON.stringify(validDesign), modelUsed: 'test-model' };
  },
});

assert.equal(result.attempts, 2, 'retries one invalid/truncated response');
assert.deepEqual(result.parsed, validDesign);
assert.equal(calls.length, 2, 'uses one bounded retry');
assert.equal(calls[0].responseFormat, 'json_object');
assert.equal(calls[1].responseFormat, 'json_object');
assert.equal(calls[0].maxTokens, 3200);
assert.equal(calls[1].temperature, 0);
assert.match(calls[1].messages.at(-1).content, /Regenerate the answer/);
assert.match(calls[1].messages.find((message) => message.role === 'user').content, /minimal overlap/);

let validCalls = 0;
const firstPass = await requestCompanyDesignJson({
  messages: [{ role: 'user', content: longRequest }],
  maxTokens: 3200,
  ownerUserId: 'test-company-owner',
  chatFn: async () => {
    validCalls += 1;
    return { content: JSON.stringify(validDesign), modelUsed: 'test-model' };
  },
});
assert.equal(firstPass.attempts, 1);
assert.equal(validCalls, 1, 'does not retry valid structured output');

console.log('company LLM design structured-output tests: OK');
