import { parseFragment } from 'parse5';

// Parse data, never HTML into the live DOM. Only these nodes reach React.
const TABLE_TAGS = new Set(['table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td']);
const INLINE_TAGS = new Set(['strong', 'b', 'em', 'i', 'code', 'del', 's', 'br', 'a']);
const DROP_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template']);

export function safeChatHref(value) {
  const href = String(value || '').trim();
  if (!href || /[\u0000-\u0020\u007f]/.test(href)) return '';
  return /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(href) ? href : '';
}

export function splitTableRow(line) {
  let src = String(line).trim();
  if (src.startsWith('|')) src = src.slice(1);
  if (/(?<!\\)\|$/.test(src)) src = src.slice(0, -1);
  const cells = [];
  let cell = '', fence = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\\' && src[i + 1] === '|') { cell += '|'; i++; continue; }
    if (src[i] === '`') {
      let count = 1;
      while (src[i + count] === '`') count++;
      if (!fence) fence = count;
      else if (fence === count) fence = 0;
      cell += '`'.repeat(count); i += count - 1; continue;
    }
    if (src[i] === '|' && !fence) { cells.push(cell.trim()); cell = ''; }
    else cell += src[i];
  }
  cells.push(cell.trim());
  return cells;
}

export function markdownTableAt(lines, index) {
  if (!lines[index]?.includes('|') || !lines[index + 1]?.includes('|')) return null;
  const headers = splitTableRow(lines[index]);
  const separator = splitTableRow(lines[index + 1]);
  if (headers.length !== separator.length || !separator.every(cell => /^:?-{3,}:?$/.test(cell))) return null;
  const align = separator.map(cell => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : 'left');
  const rows = [];
  let end = index + 2;
  while (end < lines.length && lines[end].trim() && lines[end].includes('|')) {
    const cells = splitTableRow(lines[end++]);
    rows.push(headers.map((_, i) => cells[i] || ''));
  }
  return { headers, align, rows, end };
}

export function parseSafeHtmlTable(html) {
  if (String(html).length > 250000) return null;
  const root = parseFragment(String(html));
  const table = root.childNodes.find(node => node.tagName === 'table');
  if (!table) return null;
  let count = 0;
  const clean = (node, depth = 0) => {
    if (++count > 10000 || depth > 30) return [];
    if (node.nodeName === '#text') return [node.value];
    const tag = node.tagName;
    if (!tag || DROP_TAGS.has(tag)) return [];
    const children = (node.childNodes || []).flatMap(child => clean(child, depth + 1));
    if (!TABLE_TAGS.has(tag) && !INLINE_TAGS.has(tag)) return children;
    const attrs = Object.fromEntries((node.attrs || []).map(a => [a.name, a.value]));
    const props = {};
    if (tag === 'a') props.href = safeChatHref(attrs.href);
    if (tag === 'td' || tag === 'th') {
      for (const [attr, prop] of [['colspan', 'colSpan'], ['rowspan', 'rowSpan']]) {
        if (/^\d{1,2}$/.test(attrs[attr] || '') && Number(attrs[attr]) > 0) props[prop] = Number(attrs[attr]);
      }
      // Retain only enum alignment, never arbitrary inline styles or handlers.
      const align = attrs.align || attrs.style?.match(/(?:^|;)\s*text-align\s*:\s*(left|right|center)\s*(?:;|$)/i)?.[1];
      if (/^(left|right|center)$/i.test(align || '')) props.style = { textAlign: align.toLowerCase() };
      if (tag === 'th') props.scope = 'col';
    }
    return [{ tag, props, children }];
  };
  return clean(table)[0] || null;
}

// Attachment extraction must not tear table cells or fenced examples into fragments.
export function chatLiteralRanges(text) {
  const ranges = [];
  for (const m of String(text).matchAll(/```[^\n]*\n?[\s\S]*?(?:```|$)|<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)) {
    ranges.push({ index: m.index, length: m[0].length });
  }
  const lines = String(text).split('\n');
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const table = markdownTableAt(lines, i);
    if (table) {
      const length = lines.slice(i, table.end).join('\n').length;
      ranges.push({ index: offset, length });
      offset += length + 1; i = table.end - 1;
    } else offset += lines[i].length + 1;
  }
  return ranges;
}
