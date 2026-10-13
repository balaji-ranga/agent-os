// Guide only: never reads values, clicks, submits or writes controls. Ambiguous
// labels are deliberately not selected. Cross-origin documents are not inspected.
export function findGuideField(root, field, label = field.replaceAll('_', ' ')) {
  const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const aliases = new Set([normalize(field), normalize(label)]);
  const matches = [...root.querySelectorAll('input,textarea,select')].filter(el => {
    if (el.closest('.platform-help-copilot') || el.disabled || el.hidden || !el.getClientRects().length || ['password','hidden','file','submit','button'].includes(el.type)) return false;
    const labels = [...(el.labels || [])].map(item => item.textContent);
    return [el.name, el.id, el.getAttribute('aria-label'), ...labels].some(text => aliases.has(normalize(text)));
  });
  return matches.length === 1 ? matches[0] : null;
}

export function highlightGuideField(element) {
  if (!element?.isConnected) return () => {};
  element.classList.add('copilot-guided-field');
  element.scrollIntoView({block:'center',behavior:'smooth'});
  element.focus({preventScroll:true});
  return () => element.classList.remove('copilot-guided-field');
}

export function findSourceGuideField(root,id){
  const matches=[...root.querySelectorAll('[data-copilot-control]')].filter(el=>el.getAttribute('data-copilot-control')===id&&!el.disabled&&!el.hidden&&el.getClientRects().length&&!['password','hidden','file'].includes(el.type));
  return matches.length===1?matches[0]:null;
}
