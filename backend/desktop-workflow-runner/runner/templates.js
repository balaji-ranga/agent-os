function getNestedValue(raw, path) {
  if (raw == null || !path) return '';
  const parts = String(path).split('.');
  let cur = raw;
  for (const p of parts) {
    if (cur == null) return '';
    if (typeof cur === 'string') {
      try {
        cur = JSON.parse(cur);
      } catch {
        return '';
      }
    }
    cur = cur[p];
  }
  if (cur == null) return '';
  if (typeof cur === 'object') return JSON.stringify(cur);
  return String(cur);
}

function getOutputValue(context, nodeId, outputKey = 'text') {
  const raw = context.node_outputs?.[nodeId];
  if (raw == null) return '';
  if (typeof raw === 'string') {
    if (outputKey === 'text' || outputKey === 'result' || outputKey === 'body') return raw;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return getNestedValue(parsed, outputKey);
      return raw;
    } catch {
      return raw;
    }
  }
  if (typeof raw === 'object') {
    if (outputKey.includes('.')) return getNestedValue(raw, outputKey);
    if (outputKey in raw) {
      const v = raw[outputKey];
      if (v != null && typeof v === 'object') return JSON.stringify(v);
      return v != null ? String(v) : '';
    }
    if (raw.text != null) return String(raw.text);
    return JSON.stringify(raw);
  }
  return String(raw);
}

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
    return getOutputValue(context, nodeId, path);
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
      const incoming = (graph.edges || []).filter((e) => e.target === node.id);
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
      if (value.includes('{{')) value = renderWorkflowTemplates(value, context);
      source = 'static';
    }

    resolved[key] = value;
    summary.push({ id: key, label: binding.label || key, mode: binding.mode, source, valuePreview: String(value).slice(0, 120) });
  }

  return { resolved, bindings, summary };
}

export { getOutputValue };
