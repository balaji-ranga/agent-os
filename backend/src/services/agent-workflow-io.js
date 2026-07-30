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

/** Replace {{nodeId.outputKey}} bind variables (supports nested keys e.g. body.accessToken).
 * Also supports {{var.key}} / {{variables.key}} for workflow-level static variables.
 */
export function renderWorkflowTemplates(text, context) {
  if (text == null || text === '') return text;
  let out = String(text).replace(/\{\{var(?:iables)?\.([\w.-]+)\}\}/g, (_, path) => {
    const vars = context.workflow_variables || context.variables || {};
    const v = getNestedValue(vars, path);
    return v === '' && vars[path] != null
      ? typeof vars[path] === 'object'
        ? JSON.stringify(vars[path])
        : String(vars[path])
      : v;
  });
  out = out.replace(/\{\{([\w-]+)\.([\w.-]+)\}\}/g, (_, nodeId, path) => {
    if (nodeId === 'var' || nodeId === 'variables') {
      const vars = context.workflow_variables || context.variables || {};
      const v = getNestedValue(vars, path);
      if (v !== '') return v;
      if (vars[path] != null) {
        return typeof vars[path] === 'object' ? JSON.stringify(vars[path]) : String(vars[path]);
      }
      return '';
    }
    return (() => {
      const v = getOutputValue(context, nodeId, path);
      if (v != null && typeof v === 'object') return JSON.stringify(v);
      return v;
    })();
  });
  out = out.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key === 'input') {
      return context.initial_input != null ? String(context.initial_input) : match;
    }
    const val = context[key];
    if (val == null) return match;
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  });
  return out;
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

/** Legacy {{input}} text for agent prompts. */
export function resolveInputText(node, graph, context) {
  const { resolved } = resolveNodeInputs(node, graph, context);
  const data = node.data || {};

  if (resolved.body) return resolved.body;
  if (resolved.prompt) {
    let prompt = data.prompt || data.instructions || '';
    prompt = prompt.replace(/\{\{input\}\}/g, resolved.prompt);
    if (!prompt.trim()) return resolved.prompt;
    if (!prompt.includes(resolved.prompt)) {
      return `${prompt}\n\n---\nInput:\n${resolved.prompt}\n---`.trim();
    }
    return prompt;
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
