/**
 * Optional JSON Schema for workflow trigger / A2A / webhook input.
 * Supports a practical Draft-07 subset (object/array/string/number/integer/boolean/null),
 * plus string formats `date` (YYYY-MM-DD) and `date-time`.
 * No schema → validation skipped (legacy free-form input).
 */

export class WorkflowInputSchemaError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'WorkflowInputSchemaError';
    this.code = 'INPUT_SCHEMA_VALIDATION';
    this.details = details;
  }
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

/** Accept object or JSON string; return null if empty / invalid structure. */
export function normalizeInputSchema(raw) {
  if (raw == null || raw === '') return null;
  let schema = raw;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return null;
    try {
      schema = JSON.parse(t);
    } catch {
      throw new WorkflowInputSchemaError('input_schema must be valid JSON');
    }
  }
  if (!isPlainObject(schema)) {
    throw new WorkflowInputSchemaError('input_schema must be a JSON object');
  }
  if (!Object.keys(schema).length) return null;
  if (schema.type != null && typeof schema.type !== 'string' && !Array.isArray(schema.type)) {
    throw new WorkflowInputSchemaError('input_schema.type must be a string or array of strings');
  }
  return schema;
}

export function parseInputSchemaJson(json) {
  if (json == null || json === '') return null;
  try {
    return normalizeInputSchema(typeof json === 'string' ? JSON.parse(json) : json);
  } catch (e) {
    if (e instanceof WorkflowInputSchemaError) return null;
    return null;
  }
}

export function extractInputSchemaFromGraph(graph) {
  const trigger = graph?.nodes?.find((n) => n.type === 'trigger');
  if (!trigger) return null;
  try {
    return normalizeInputSchema(trigger.data?.inputSchema ?? trigger.data?.input_schema ?? null);
  } catch {
    return null;
  }
}

function typeMatches(value, type) {
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isPlainObject(value);
  return true;
}

function validateAgainstSchema(value, schema, path, errors) {
  if (!schema || typeof schema !== 'object') return;

  if (Array.isArray(schema.enum) && schema.enum.length) {
    const ok = schema.enum.some(
      (e) => Object.is(e, value) || (typeof e === 'object' && JSON.stringify(e) === JSON.stringify(value))
    );
    if (!ok) errors.push(`${path}: must be one of ${JSON.stringify(schema.enum)}`);
  }

  if (schema.type != null) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(value, t))) {
      errors.push(
        `${path}: expected type ${types.join('|')}, got ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}`
      );
      return;
    }
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${path}: minLength ${schema.minLength}`);
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(`${path}: maxLength ${schema.maxLength}`);
    }
    if (typeof schema.pattern === 'string') {
      try {
        if (!new RegExp(schema.pattern).test(value)) errors.push(`${path}: pattern mismatch`);
      } catch {
        /* ignore bad pattern */
      }
    }
    if (schema.format === 'date') {
      // JSON Schema date: full-date YYYY-MM-DD (calendar-valid)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        errors.push(`${path}: format date requires YYYY-MM-DD`);
      } else {
        const [y, m, d] = value.split('-').map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d));
        if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
          errors.push(`${path}: format date is not a valid calendar date`);
        }
      }
    } else if (schema.format === 'date-time') {
      const t = Date.parse(value);
      if (!Number.isFinite(t)) errors.push(`${path}: format date-time is not a valid ISO datetime`);
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${path}: minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${path}: maximum ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${path}: minItems ${schema.minItems}`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${path}: maxItems ${schema.maxItems}`);
    }
    if (schema.items) {
      value.forEach((item, i) => validateAgainstSchema(item, schema.items, `${path}[${i}]`, errors));
    }
  }

  if (isPlainObject(value) && (schema.properties || schema.required || schema.additionalProperties != null)) {
    const props = schema.properties || {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (!(key in value) || value[key] === undefined) {
        errors.push(`${path}.${key}: required`);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (props[key]) {
        validateAgainstSchema(child, props[key], `${path}.${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key}: additional property not allowed`);
      } else if (isPlainObject(schema.additionalProperties)) {
        validateAgainstSchema(child, schema.additionalProperties, `${path}.${key}`, errors);
      }
    }
  }
}

/**
 * Coerce free-form run input into a value to validate.
 * - objects/arrays: as-is
 * - JSON strings: parse
 * - plain text + object schema with `message`: wrap as { message }
 * - plain text + string schema: keep string
 */
export function coerceWorkflowInput(rawInput, schema, { trigger = 'manual' } = {}) {
  if (rawInput != null && typeof rawInput === 'object') {
    return { value: rawInput, display: JSON.stringify(rawInput) };
  }

  const text = rawInput == null ? '' : String(rawInput);
  const trimmed = text.trim();

  if (!schema) {
    return { value: text, display: text };
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      return { value: parsed, display: trimmed };
    } catch {
      /* fall through */
    }
  }

  const types = schema.type == null ? null : Array.isArray(schema.type) ? schema.type : [schema.type];
  const wantsObject = !types || types.includes('object');
  const wantsString = types && types.includes('string') && !types.includes('object');

  if (wantsString) {
    return { value: text, display: text };
  }

  if (wantsObject) {
    const props = schema.properties || {};
    const hasMessage = 'message' in props || (Array.isArray(schema.required) && schema.required.includes('message'));
    if (hasMessage || Object.keys(props).length === 0 || props.message) {
      const wrapped = { message: text };
      return { value: wrapped, display: JSON.stringify(wrapped) };
    }
  }

  throw new WorkflowInputSchemaError(
    'Input must be JSON matching the workflow input schema (plain text was not accepted)',
    { hint: 'Send a JSON object body or A2A message that parses as JSON', trigger }
  );
}

export function validateWorkflowInput(schema, rawInput, { trigger = 'manual' } = {}) {
  const normalized = normalizeInputSchema(schema);
  if (!normalized) {
    if (rawInput != null && typeof rawInput === 'object') {
      return { value: rawInput, display: JSON.stringify(rawInput), schema: null };
    }
    const text = rawInput == null ? '' : String(rawInput);
    return { value: text, display: text, schema: null };
  }

  const coerced = coerceWorkflowInput(rawInput, normalized, { trigger });
  const errors = [];
  validateAgainstSchema(coerced.value, normalized, '$', errors);
  if (errors.length) {
    throw new WorkflowInputSchemaError(`Input failed schema validation: ${errors.slice(0, 8).join('; ')}`, {
      errors,
      schema: normalized,
    });
  }
  return { ...coerced, schema: normalized };
}

/** Resolve schema: explicit override → A2A publication → definition column → published trigger node. */
export function resolveWorkflowInputSchema({ def = null, graph = null, publicationSchema = null, override = null } = {}) {
  if (override !== undefined && override !== null && override !== '') {
    return normalizeInputSchema(override);
  }
  if (publicationSchema != null && publicationSchema !== '') {
    return normalizeInputSchema(publicationSchema);
  }
  if (def?.input_schema != null) {
    return normalizeInputSchema(def.input_schema);
  }
  return extractInputSchemaFromGraph(graph || def?.published_graph || def?.draft_graph);
}
