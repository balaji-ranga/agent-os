/**
 * Unit + smoke tests for optional workflow input JSON Schema.
 * Usage: node scripts/test-workflow-input-schema.js
 */
import assert from 'assert';
import {
  coerceWorkflowInput,
  normalizeInputSchema,
  validateWorkflowInput,
  WorkflowInputSchemaError,
} from '../src/services/workflow-input-schema.js';

const SCHEMA = {
  type: 'object',
  required: ['ticker'],
  properties: {
    ticker: { type: 'string', minLength: 1 },
    qty: { type: 'integer', minimum: 1 },
    message: { type: 'string' },
  },
  additionalProperties: false,
};

function ok(name) {
  console.log('PASS', name);
}

{
  assert.strictEqual(normalizeInputSchema(null), null);
  assert.strictEqual(normalizeInputSchema({}), null);
  assert.deepStrictEqual(normalizeInputSchema(SCHEMA).required, ['ticker']);
  ok('normalizeInputSchema');
}

{
  const v = validateWorkflowInput(null, 'hello');
  assert.strictEqual(v.value, 'hello');
  ok('no schema free-form');
}

{
  const v = validateWorkflowInput(SCHEMA, { ticker: 'AAPL', qty: 2 });
  assert.strictEqual(v.value.ticker, 'AAPL');
  ok('valid object');
}

{
  let threw = false;
  try {
    validateWorkflowInput(SCHEMA, { qty: 1 });
  } catch (e) {
    threw = e instanceof WorkflowInputSchemaError;
  }
  assert.ok(threw);
  ok('missing required rejects');
}

{
  let threw = false;
  try {
    validateWorkflowInput(SCHEMA, { ticker: 'AAPL', extra: true });
  } catch (e) {
    threw = e instanceof WorkflowInputSchemaError;
  }
  assert.ok(threw);
  ok('additionalProperties false rejects');
}

{
  const v = validateWorkflowInput(SCHEMA, JSON.stringify({ ticker: 'MSFT' }));
  assert.strictEqual(v.value.ticker, 'MSFT');
  ok('JSON string parses');
}

{
  const soft = {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
  };
  const v = validateWorkflowInput(soft, 'run please', { trigger: 'chat' });
  assert.strictEqual(v.value.message, 'run please');
  ok('chat text wraps to message');
}

{
  const c = coerceWorkflowInput({ ticker: 'X' }, SCHEMA);
  assert.strictEqual(c.value.ticker, 'X');
  ok('coerce object');
}

console.log('ALL_WORKFLOW_INPUT_SCHEMA_UNIT_OK');
