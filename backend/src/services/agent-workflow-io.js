/**
 * Resolve workflow step inputs (static vs dynamic from previous step outputs).
 * Media refs ({ kind, artifactId, url, mimeType }) are preserved as JSON objects
 * in resolved bindings when the output key is a known media port.
 */

const MEDIA_OUTPUT_KEYS = new Set(['audio', 'video', 'media', 'playback', 'model']);

function looksLikeMediaRef(v) {
  return (
    v != null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    (v.artifactId || v.kind === 'audio' || v.kind === 'video' || v.kind === 'model')
  );
}

function getNestedValue(raw, path, { keepObject = false } = {}) {
  if (raw == null || !path) return keepObject ? undefined : '';
  const parts = String(path).split('.');
  let cur = raw;
  for (const p of parts) {
    if (cur == null) return keepObject ? undefined : '';
    if (typeof cur === 'string') {
      try {
        cur = JSON.parse(cur);
      } catch {
        return keepObject ? undefined : '';
      }
    }
    cur = cur[p];
  }
  if (cur == null) return keepObject ? undefined : '';
  if (typeof cur === 'object') {
    if (keepObject || looksLikeMediaRef(cur)) return cur;
    return JSON.stringify(cur);
  }
  return String(cur);
}

function getOutputValue(context, nodeId, outputKey = 'text') {
  const raw = context.node_outputs?.[nodeId];
  const keepObject = MEDIA_OUTPUT_KEYS.has(String(outputKey || '').split('.')[0]);
  if (raw == null) return keepObject ? null : '';
  if (typeof raw === 'string') {
    if (outputKey === 'text' || outputKey === 'result' || outputKey === 'body') return raw;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return getNestedValue(parsed, outputKey, { keepObject });
      return raw;
    } catch {
      return raw;
    }
  }
  if (typeof raw === 'object') {
    if (outputKey.includes('.')) return getNestedValue(raw, outputKey, { keepObject });
    if (outputKey in raw) {
      const v = raw[outputKey];
      if (v != null && typeof v === 'object') {
        if (keepObject || looksLikeMediaRef(v) || outputKey === 'result' || outputKey === 'body' || outputKey === 'playback') {
          return v;
        }
        return JSON.stringify(v);
      }
      return v != null ? String(v) : keepObject ? null : '';
    }
    if (raw.text != null) return String(raw.text);
    return keepObject ? raw : JSON.stringify(raw);
  }
  return String(raw);
}

/** Format a value for embedding into a template string.
 * When the placeholder sits inside JSON string quotes, escape as JSON string content.
 * When it sits as a bare JSON value, emit full JSON.stringify (incl. quotes for strings).
 */
function formatTemplateEmbed(value, { quotedStringContext = false } = {}) {
  if (quotedStringContext) {
    return JSON.stringify(value == null ? '' : value).slice(1, -1);
  }
  if (value != null && typeof value === 'object') return JSON.stringify(value);
  if (value === undefined || value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // bare JSON string value
  return JSON.stringify(String(value));
}

function isLikelyJsonTemplate(text) {
  const t = String(text || '').trim();
  // Bare {{var.x}} / {{node.out}} start with '{' but are not JSON objects.
  if (t.startsWith('{{')) return false;
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

/** Replace {{nodeId.outputKey}} bind variables (supports nested keys e.g. body.accessToken).
 * Also supports {{var.key}} / {{variables.key}} for workflow-level static variables.
 * JSON-safe: placeholders inside "..." get escaped; bare JSON placeholders use JSON.stringify.
 */
export function renderWorkflowTemplates(text, context) {
  if (text == null || text === '') return text;
  const jsonish = isLikelyJsonTemplate(text);

  const resolveVar = (path) => {
    const vars = context.workflow_variables || context.variables || {};
    const nested = getNestedValue(vars, path);
    if (nested !== '' || nested === 0 || nested === false) return nested;
    if (vars[path] != null) return vars[path];
    return '';
  };

  let out = String(text);

  const sub = (re, lookup, keepMatchIf) => {
    out = out.replace(re, (match, ...args) => {
      const offset = args[args.length - 2];
      const full = args[args.length - 1];
      const value = lookup(...args.slice(0, -2));
      if (keepMatchIf && keepMatchIf(value, match, ...args.slice(0, -2))) return match;
      const before = offset > 0 ? full[offset - 1] : '';
      const after = full[offset + match.length] || '';
      const quotedStringContext = before === '"' && after === '"';
      if (quotedStringContext) {
        return formatTemplateEmbed(value, { quotedStringContext: true });
      }
      if (jsonish) {
        return formatTemplateEmbed(value, { quotedStringContext: false });
      }
      if (value != null && typeof value === 'object') return JSON.stringify(value);
      return value == null ? '' : String(value);
    });
  };

  sub(/\{\{var(?:iables)?\.([\w.-]+)\}\}/g, (path) => resolveVar(path));
  sub(/\{\{([\w-]+)\.([\w.-]+)\}\}/g, (nodeId, path) => {
    if (nodeId === 'var' || nodeId === 'variables') return resolveVar(path);
    return getOutputValue(context, nodeId, path);
  });
  sub(
    /\{\{(\w+)\}\}/g,
    (key) => {
      if (key === 'input') return context.initial_input;
      if (Object.prototype.hasOwnProperty.call(context, key)) return context[key];
      return undefined;
    },
    (value, match) => value === undefined && match.startsWith('{{')
  );

  return out;
}

/**
 * Deep-render {{var.*}} / {{nodeId.key}} inside a tool/API payload object.
 * Workflow toolPayload was previously passed through unrendered, so
 * indexSymbol "{{var.index_symbol}}" was sent to vendors as a literal.
 */
export function renderPayloadTemplates(payload, context) {
  if (payload == null || !context) return payload;
  if (typeof payload === 'string') {
    return payload.includes('{{') ? renderWorkflowTemplates(payload, context) : payload;
  }
  if (typeof payload !== 'object') return payload;
  try {
    const raw = JSON.stringify(payload);
    if (!raw.includes('{{')) return payload;
    return JSON.parse(renderWorkflowTemplates(raw, context));
  } catch (e) {
    console.warn('[workflow] renderPayloadTemplates failed: %s', e.message || e);
    return payload;
  }
}

/**
 * Resolve all input bindings for a node.
 * @returns {{ resolved: Record<string,string>, bindings: Array, summary: Array }}
 */
export function resolveNodeInputs(node, graph, context) {
  const data = node.data || {};
  const bindings = data.inputBindings || [];
  const resolved = {};
  const summary = [];

  for (const binding of bindings) {
    const key = binding.id;
    let value = '';
    let source = 'static';

    if (binding.mode === 'dynamic' && binding.sourceNodeId) {
      value = getOutputValue(context, binding.sourceNodeId, binding.sourceOutputKey || 'text');
      source = `step:${binding.sourceNodeId}.${binding.sourceOutputKey || 'text'}`;
    } else if (binding.mode === 'workflow_variable' || binding.mode === 'variable') {
      const vars = context.workflow_variables || context.variables || {};
      const keyPath = binding.variableKey || binding.sourceOutputKey || binding.id;
      const nested = getNestedValue(vars, keyPath);
      if (nested !== '') value = nested;
      else if (vars[keyPath] != null) {
        value = typeof vars[keyPath] === 'object' ? JSON.stringify(vars[keyPath]) : String(vars[keyPath]);
      } else value = '';
      source = `var:${keyPath}`;
    } else if (binding.mode === 'dynamic') {
      const incoming = graph.edges.filter((e) => e.target === node.id);
      if (incoming.length === 1) {
        value = getOutputValue(context, incoming[0].source, binding.sourceOutputKey || 'text');
        source = `previous:${incoming[0].source}`;
      } else if (incoming.length > 1) {
        value = incoming
          .map((e) => getOutputValue(context, e.source, binding.sourceOutputKey || 'text'))
          .filter(Boolean)
          .join('\n\n');
        source = 'merge:previous';
      }
    } else {
      value = binding.value != null ? String(binding.value) : '';
      // Allow {{nodeId.key}} / {{var.key}} in static bindings (e.g. compose maker user message)
      if (value.includes('{{')) {
        value = renderWorkflowTemplates(value, context);
      }
      source = 'static';
    }

    resolved[key] = value;
    const preview =
      value != null && typeof value === 'object'
        ? JSON.stringify(value).slice(0, 200)
        : String(value ?? '');
    summary.push({
      id: key,
      label: binding.label || key,
      mode: binding.mode,
      source,
      value,
      valuePreview: preview.length > 200 ? `${preview.slice(0, 200)}…` : preview,
    });
  }

  if (context.initial_input && !resolved.prompt && node.type === 'agent') {
    resolved.prompt = String(context.initial_input);
  }

  return { resolved, bindings, summary };
}

function appendExtraResolvedBindings(base, resolved, excludeKeys = []) {
  const skip = new Set(excludeKeys);
  const extras = Object.entries(resolved || {})
    .filter(([k, v]) => v != null && String(v).trim() && !skip.has(k))
    .map(([k, v]) => `--- ${k} ---\n${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  if (!extras.length) return base;
  if (!base || !String(base).trim()) return extras.join('\n\n');
  return `${String(base).trim()}\n\n${extras.join('\n\n')}`;
}

/** Legacy {{input}} text for agent prompts. */
export function resolveInputText(node, graph, context) {
  const { resolved } = resolveNodeInputs(node, graph, context);
  const data = node.data || {};

  if (resolved.body) {
    return appendExtraResolvedBindings(resolved.body, resolved, ['body', 'prompt']);
  }
  if (resolved.prompt) {
    let prompt = data.prompt || data.instructions || '';
    prompt = prompt.replace(/\{\{input\}\}/g, resolved.prompt);
    let out;
    if (!prompt.trim()) out = resolved.prompt;
    else if (!prompt.includes(resolved.prompt)) {
      out = `${prompt}\n\n---\nInput:\n${resolved.prompt}\n---`.trim();
    } else out = prompt;
    // Multi-binding agents (e.g. Channel Publisher: prompt=CEO text + post_bodies=reviewer)
    return appendExtraResolvedBindings(out, resolved, ['prompt', 'body']);
  }

  const parts = Object.entries(resolved)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`);
  return parts.join('\n\n') || '(no input)';
}

/** Structured outputs stored on context.node_outputs[nodeId]. */
export function storeNodeOutput(context, nodeId, outputs) {
  context.node_outputs = context.node_outputs || {};
  context.node_outputs[nodeId] = outputs;
  return context;
}

export function outputToContextValue(outputs) {
  if (outputs == null) return '';
  if (typeof outputs === 'string') return outputs;
  if (outputs.text != null) return String(outputs.text);
  return JSON.stringify(outputs);
}

export function getNodeOutputList(node) {
  return node.data?.outputs || [];
}

export function getNodeInputList(node) {
  return node.data?.inputBindings || [];
}
