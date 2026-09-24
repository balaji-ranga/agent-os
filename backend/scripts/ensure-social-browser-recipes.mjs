/**
 * Ensure one verified dynamic-post recipe exists for LinkedIn and Facebook.
 *
 * Usage:
 *   node scripts/ensure-social-browser-recipes.mjs --owner-id ceo-example
 *   node scripts/ensure-social-browser-recipes.mjs --user-name "Example Owner"
 */
import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
config({ path: join(scriptDir, '..', '.env') });

const { initDb, getDb } = await import('../src/db/schema.js');
const {
  appendRecipeStep,
  createRecipe,
  getRecipe,
  listRecipes,
  publishRecipe,
  recipeRequiredInputs,
} = await import('../src/services/browser-recipes.js');
const { inferSocialPlatform } = await import('../src/services/browser-social-publish.js');
initDb();

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}

const requestedId = valueAfter('--owner-id');
const requestedName = valueAfter('--user-name');
if ((!requestedId && !requestedName) || (requestedId && requestedName)) {
  console.error('Specify exactly one of --owner-id or --user-name');
  process.exit(2);
}

const db = getDb();
let ownerId = requestedId;
if (requestedName) {
  const matches = db.prepare(
    `SELECT id FROM platform_users WHERE lower(name) = lower(?) ORDER BY id`
  ).all(requestedName);
  if (matches.length !== 1) {
    console.error(matches.length ? 'User name is ambiguous; use --owner-id' : 'User was not found');
    process.exit(2);
  }
  ownerId = matches[0].id;
}

const existing = listRecipes(ownerId, { limit: 50, offset: 0 }).recipes
  .map((item) => getRecipe(ownerId, item.id))
  .filter(Boolean);

const definitions = {
  linkedin: {
    name: 'LinkedIn verified dynamic post',
    start_url: 'https://www.linkedin.com/feed/',
    trigger: 'Start a post',
    submit: 'Post',
  },
  facebook: {
    name: 'Facebook verified dynamic post',
    start_url: 'https://www.facebook.com/',
    trigger: "What's on your mind",
    submit: 'Post',
  },
};

const results = [];
for (const [platform, definition] of Object.entries(definitions)) {
  const found = existing.find((recipe) => {
    const url = recipe.start_url || recipe.steps.find((step) => step.action === 'open')?.args?.url || '';
    return inferSocialPlatform('', url) === platform && recipeRequiredInputs(recipe).includes('post_content');
  });
  if (found) {
    results.push({ platform, recipe_id: found.id, recipe_name: found.name, created: false });
    continue;
  }
  let recipe = createRecipe(ownerId, {
    name: definition.name,
    description: `Verified ${platform} post recipe. Runtime resolves stable controls and requires pre/postconditions.`,
    start_url: definition.start_url,
    domain_allowlist: [new URL(definition.start_url).hostname],
  });
  recipe = await appendRecipeStep(ownerId, recipe.id, {
    action: 'open', args: { url: definition.start_url }, label: `Open ${platform}`,
  });
  recipe = await appendRecipeStep(ownerId, recipe.id, {
    action: 'act', args: { request: { kind: 'click', text: definition.trigger } }, label: 'Open composer',
  });
  recipe = await appendRecipeStep(ownerId, recipe.id, {
    action: 'act', args: { request: { kind: 'type', text: '{{post_content}}' } }, label: 'Enter exact post content',
  });
  recipe = await appendRecipeStep(ownerId, recipe.id, {
    action: 'act', args: { request: { kind: 'click', text: definition.submit } }, label: 'Submit once and verify',
  });
  recipe = publishRecipe(ownerId, recipe.id);
  results.push({ platform, recipe_id: recipe.id, recipe_name: recipe.name, created: true });
}

console.log(JSON.stringify({ owner_id: ownerId, recipes: results }, null, 2));
