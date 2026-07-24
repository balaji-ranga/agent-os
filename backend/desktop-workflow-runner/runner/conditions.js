import { getOutputValue } from './templates.js';

export function evaluateCondition(condition, context) {
  if (!condition?.sourceNodeId && condition?.mode !== 'static') return false;

  const left = condition.mode === 'static'
    ? String(condition.value ?? '')
    : getOutputValue(context, condition.sourceNodeId, condition.sourceOutputKey || 'text');
  const right = String(condition.compareValue ?? condition.value ?? '');
  const op = condition.operator || 'contains';
  const l = String(left).trim();
  const r = right.trim();

  switch (op) {
    case 'eq':
      return l === r || l.toLowerCase() === r.toLowerCase();
    case 'ne':
      return l !== r && l.toLowerCase() !== r.toLowerCase();
    case 'contains':
      return l.toLowerCase().includes(r.toLowerCase());
    case 'not_contains':
      return !l.toLowerCase().includes(r.toLowerCase());
    case 'gt':
      return Number(l) > Number(r);
    case 'lt':
      return Number(l) < Number(r);
    case 'gte':
      return Number(l) >= Number(r);
    case 'lte':
      return Number(l) <= Number(r);
    case 'empty':
      return !l;
    case 'not_empty':
      return !!l;
    default:
      return l.toLowerCase().includes(r.toLowerCase());
  }
}
