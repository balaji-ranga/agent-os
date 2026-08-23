/**
 * Browser recipes — reusable recorded action trails (no CEO scripting).
 */
import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';

function nowIso() {
  return new Date().toISOString();
}

function parseJson(raw, fallback) {
  try {
    return JSON.parse(raw || '') ?? fallback;
  } catch {
    return fallback;
  }
}

const RECIPE_INPUT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const RECIPE_INPUT_TOKEN = /\{\{\s*([A-Za-z][A-Za-z0-9_]{0,63})\s*\}\}/g;

function collectInputNames(value, names = new Set()) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(RECIPE_INPUT_TOKEN)) names.add(match[1]);
  } else if (Array.isArray(value)) {
    for (const item of value) collectInputNames(item, names);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectInputNames(item, names);
  }
  return names;
}

export function recipeRequiredInputs(recipe) {
  return [...collectInputNames((recipe?.steps || []).map((step) => step.args || {}))].sort();
}

export function normalizeRecipeInputs(value) {
  if (value == null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const err = new Error('recipe inputs must be an object');
    err.status = 400;
    throw err;
  }
  const out = {};
  for (const [key, input] of Object.entries(value)) {
    if (!RECIPE_INPUT_NAME.test(key)) {
      const err = new Error(`invalid recipe input name "${String(key).slice(0, 80)}"`);
      err.status = 400;
      throw err;
    }
    if (input == null || ['string', 'number', 'boolean'].includes(typeof input)) out[key] = input ?? '';
    else {
      const err = new Error(`recipe input "${key}" must be a string, number, or boolean`);
      err.status = 400;
      throw err;
    }
  }
  return out;
}

export function substituteRecipeInputs(value, inputs) {
  if (typeof value === 'string') {
    const exact = value.match(/^\{\{\s*([A-Za-z][A-Za-z0-9_]{0,63})\s*\}\}$/);
    if (exact) return inputs[exact[1]];
    return value.replace(RECIPE_INPUT_TOKEN, (_token, name) => String(inputs[name]));
  }
  if (Array.isArray(value)) return value.map((item) => substituteRecipeInputs(item, inputs));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substituteRecipeInputs(item, inputs)]));
  }
  return value;
}

function mapRecipeRow(row) {
  if (!row) return null;
  return {
    ...row,
    domain_allowlist: parseJson(row.domain_allowlist_json, []),
  };
}

export function listRecipes(ceoUserId, { limit = 10, offset = 0 } = {}) {
  const db = getDb();
  const lim = Math.min(50, Math.max(1, Number(limit) || 10));
  const off = Math.max(0, Number(offset) || 0);
  const total =
    db.prepare('SELECT COUNT(*) AS c FROM browser_recipes WHERE ceo_user_id = ?').get(ceoUserId)?.c || 0;
  const recipes = db
    .prepare(
      `SELECT id, ceo_user_id, name, description, status, start_url, version, created_at, updated_at,
        (SELECT COUNT(*) FROM browser_recipe_steps s WHERE s.recipe_id = browser_recipes.id) AS step_count,
        (SELECT COUNT(*) FROM browser_recipe_steps s
          WHERE s.recipe_id = browser_recipes.id AND lower(s.action) IN ('open','act','click','type','press','scroll')) AS actionable_steps
       FROM browser_recipes WHERE ceo_user_id = ?
       ORDER BY updated_at DESC LIMIT ? OFFSET ?`
    )
    .all(ceoUserId, lim, off);
  const withInputs = recipes.map((recipe) => ({
    ...recipe,
    required_inputs: recipeRequiredInputs(getRecipe(ceoUserId, recipe.id)),
  }));
  return { recipes: withInputs, total, limit: lim, offset: off, has_more: off + recipes.length < total };
}

export function getRecipe(ceoUserId, recipeId) {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM browser_recipes WHERE id = ? AND ceo_user_id = ?')
    .get(recipeId, ceoUserId);
  if (!row) return null;
  const steps = db
    .prepare(
      `SELECT id, step_order, action, args_json, label, on_error, created_at
       FROM browser_recipe_steps WHERE recipe_id = ? ORDER BY step_order ASC`
    )
    .all(recipeId)
    .map((s) => ({
      ...s,
      args: parseJson(s.args_json, {}),
    }));
  const recipe = {
    ...mapRecipeRow(row),
    steps,
  };
  return { ...recipe, required_inputs: recipeRequiredInputs(recipe) };
}

/** Resolve by exact name (case-insensitive); prefer published. */
export function getRecipeByName(ceoUserId, name) {
  const n = String(name || '').trim();
  if (!n) return null;
  const db = getDb();
  const row =
    db
      .prepare(
        `SELECT * FROM browser_recipes
         WHERE ceo_user_id = ? AND lower(name) = lower(?)
         ORDER BY CASE status WHEN 'published' THEN 0 ELSE 1 END, updated_at DESC
         LIMIT 1`
      )
      .get(ceoUserId, n) || null;
  return row ? getRecipe(ceoUserId, row.id) : null;
}

export function createRecipe(ceoUserId, { name, description = '', start_url = '', domain_allowlist = [] }) {
  const db = getDb();
  const id = `br-${randomUUID()}`;
  db.prepare(
    `INSERT INTO browser_recipes (
      id, ceo_user_id, name, description, status, start_url, domain_allowlist_json, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'draft', ?, ?, 1, ?, ?)`
  ).run(
    id,
    ceoUserId,
    String(name || 'Untitled recipe').slice(0, 200),
    String(description || '').slice(0, 2000),
    start_url || '',
    JSON.stringify(domain_allowlist || []),
    nowIso(),
    nowIso()
  );
  console.info('[browser-recipe] created id=%s ceo=%s name=%s', id, ceoUserId, name);
  return getRecipe(ceoUserId, id);
}

export function renameRecipe(ceoUserId, recipeId, name) {
  const n = String(name || '').trim().slice(0, 200);
  if (!n) {
    const err = new Error('name is required');
    err.status = 400;
    throw err;
  }
  const db = getDb();
  const info = db
    .prepare(`UPDATE browser_recipes SET name = ?, updated_at = ? WHERE id = ? AND ceo_user_id = ?`)
    .run(n, nowIso(), recipeId, ceoUserId);
  if (!info.changes) {
    const err = new Error('Recipe not found');
    err.status = 404;
    throw err;
  }
  console.info('[browser-recipe] renamed id=%s name=%s', recipeId, n);
  return getRecipe(ceoUserId, recipeId);
}

export function appendRecipeStep(ceoUserId, recipeId, { action, args = {}, label = '', on_error = 'stop' }) {
  const recipe = getRecipe(ceoUserId, recipeId);
  if (!recipe) {
    const err = new Error('Recipe not found');
    err.status = 404;
    throw err;
  }
  const db = getDb();
  const maxOrder =
    db.prepare('SELECT COALESCE(MAX(step_order), 0) AS m FROM browser_recipe_steps WHERE recipe_id = ?').get(
      recipeId
    ).m || 0;
  db.prepare(
    `INSERT INTO browser_recipe_steps (recipe_id, step_order, action, args_json, label, on_error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    recipeId,
    maxOrder + 1,
    String(action || 'snapshot'),
    JSON.stringify(args || {}),
    String(label || '').slice(0, 500),
    on_error === 'continue' || on_error === 'retry' ? on_error : 'stop',
    nowIso()
  );
  db.prepare(`UPDATE browser_recipes SET updated_at = ? WHERE id = ? AND ceo_user_id = ?`).run(
    nowIso(),
    recipeId,
    ceoUserId
  );
  return getRecipe(ceoUserId, recipeId);
}

export function publishRecipe(ceoUserId, recipeId) {
  const db = getDb();
  const info = db
    .prepare(
      `UPDATE browser_recipes SET status = 'published', updated_at = ? WHERE id = ? AND ceo_user_id = ?`
    )
    .run(nowIso(), recipeId, ceoUserId);
  if (!info.changes) {
    const err = new Error('Recipe not found');
    err.status = 404;
    throw err;
  }
  return getRecipe(ceoUserId, recipeId);
}

export function deleteRecipe(ceoUserId, recipeId) {
  const db = getDb();
  db.prepare('DELETE FROM browser_recipe_steps WHERE recipe_id = ?').run(recipeId);
  const info = db
    .prepare('DELETE FROM browser_recipes WHERE id = ? AND ceo_user_id = ?')
    .run(recipeId, ceoUserId);
  console.info('[browser-recipe] deleted id=%s ceo=%s ok=%s', recipeId, ceoUserId, info.changes > 0);
  return { ok: info.changes > 0 };
}

export function countActionableRecipeSteps(recipe) {
  const steps = recipe?.steps || [];
  return steps.filter((s) =>
    ['open', 'act', 'click', 'type', 'press', 'scroll'].includes(String(s.action || '').toLowerCase())
  ).length;
}
