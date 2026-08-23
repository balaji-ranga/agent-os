import assert from 'node:assert/strict';
import {
  normalizeRecipeInputs,
  prepareRecipeInputs,
  recipeRequiredInputs,
  substituteRecipeInputs,
} from '../src/services/browser-recipes.js';

const recipe = {
  steps: [{ args: { request: { text: 'Hello {{post_content}}', count: '{{count}}' } } }],
};

assert.deepEqual(recipeRequiredInputs(recipe), ['count', 'post_content']);
assert.deepEqual(
  substituteRecipeInputs(recipe.steps[0].args, { post_content: 'world', count: 2 }),
  { request: { text: 'Hello world', count: 2 } }
);
assert.deepEqual(normalizeRecipeInputs({ post_content: 'text', count: 2, enabled: true }), {
  post_content: 'text',
  count: 2,
  enabled: true,
});
assert.throws(() => normalizeRecipeInputs({ '__proto__.bad': 'x' }), /invalid recipe input name/);
assert.throws(() => normalizeRecipeInputs({ post_content: { nested: true } }), /must be a string, number, or boolean/);

assert.deepEqual(prepareRecipeInputs(recipe, { post_content: 'verbatim' }), {
  required_inputs: ['count', 'post_content'],
  resolved_inputs: { post_content: 'verbatim' },
  missing_inputs: ['count'],
  ready: false,
});
assert.deepEqual(prepareRecipeInputs(recipe, { post_content: 'verbatim', count: 3, unused: 'ignored' }), {
  required_inputs: ['count', 'post_content'],
  resolved_inputs: { count: 3, post_content: 'verbatim' },
  missing_inputs: [],
  ready: true,
});

console.log('browser recipe dynamic input tests passed');
