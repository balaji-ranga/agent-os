import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { markdownTableAt, parseSafeHtmlTable, safeChatHref, chatLiteralRanges } from '../src/utils/chatTables.js';
import { guessChatMediaType } from '../src/utils/resolveMediaSrc.js';

assert.deepEqual(markdownTableAt(['| A | B |', '| :--- | ---: |', '| escaped\\|pipe | `x|y` |'], 0), {
  headers: ['A', 'B'], align: ['left', 'right'], rows: [['escaped|pipe', '`x|y`']], end: 3,
});
assert.equal(markdownTableAt(['one | two', 'not | table'], 0), null);
for (const href of ['javascript:alert(1)', 'data:text/html,x', '//evil.test', 'java\nscript:x']) assert.equal(safeChatHref(href), '');
assert.equal(safeChatHref('/api/media/owner/file.pdf'), '/api/media/owner/file.pdf');
assert.equal(guessChatMediaType('/api/media/openclaw/generated/owner/report.md'), 'markdown');
const sanitized = JSON.stringify(parseSafeHtmlTable('<table onclick="bad()"><tr><td style="text-align:right;background:url(x)" colspan="2"><script>BAD</script><a href="javascript:alert(1)">Safe</a><strong>bold</strong></td></tr></table>'));
assert(!sanitized.includes('BAD') && !sanitized.includes('onclick') && !sanitized.includes('javascript') && !sanitized.includes('background'));
assert(sanitized.includes('colSpan') && sanitized.includes('right') && sanitized.includes('strong'));
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', configFile: false, esbuild: { jsx: 'automatic' },
  // Goal routing is outside this isolated media renderer regression.
  plugins: [{ name: 'media-test-goal-panel-stub', enforce: 'pre', resolveId(id) { if (/GoalPlanPanel(?:\.jsx)?$/.test(id)) return '\0media-goal-stub'; }, load(id) { if (id === '\0media-goal-stub') return 'export default function GoalPanel(){return null}; export function collectGoalRunIds(){return []}'; } }],
  optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { default: ChatMessageContent } = await server.ssrLoadModule('/src/components/ChatMessageContent.jsx');
  for (const content of [
    'Before\n| Rank | Bank |\n| ---: | --- |\n| 1 | **JPMC** |\n\nAfter',
    'Before\n<table><caption>Rankings</caption><tr><th>Rank</th><th>Bank</th></tr><tr><td>1</td><td>JPMC</td></tr></table>\nAfter',
  ]) {
    const html = renderToStaticMarkup(createElement(ChatMessageContent, { content }));
    assert(html.includes('<table') && html.includes('<th') && html.includes('<td'));
    assert(html.includes('Before') && html.includes('After'));
  }
  const linked = '| File |\n| --- |\n| [PDF](/api/media/owner/report.pdf) |';
  assert(chatLiteralRanges(linked).length === 1);
  const html = renderToStaticMarkup(createElement(ChatMessageContent, { content: linked }));
  assert(html.includes('<td') && html.includes('href="/api/media/owner/report.pdf"') && !html.includes('iframe'));
  const fenced = renderToStaticMarkup(createElement(ChatMessageContent, { content: '```html\n<table><tr><td>literal</td></tr></table>\n```' }));
  assert(!fenced.includes('<table') && fenced.includes('&lt;table&gt;'));
  const unsafe = renderToStaticMarkup(createElement(ChatMessageContent, { content: '<table><tr><td><img src="x" onerror="bad()"><a href="javascript:bad()">bad link</a></td></tr></table>' }));
  assert(!unsafe.includes('<img') && !unsafe.includes('javascript') && !unsafe.includes('onerror'));
  const md = renderToStaticMarkup(createElement(ChatMessageContent, { content: '[Report](/api/media/openclaw/generated/owner/report.md)' }));
  assert(md.includes('Markdown attachment') && !md.includes('<img'));
  assert.equal(guessChatMediaType('/api/media/openclaw/downloads/owner/report.xlsx'), 'file');
  const generic = renderToStaticMarkup(createElement(ChatMessageContent, { content: 'MEDIA:/root/.openclaw/media/downloads/owner/report.xlsx' }));
  assert(/attachment/i.test(generic) && !generic.includes('<img') && !generic.includes('iframe'));
  const { default: ChatToolCalls } = await server.ssrLoadModule('/src/components/ChatToolCalls.jsx');
  const scan = renderToStaticMarkup(createElement(ChatToolCalls, { toolCalls: [{ tool_name: 'download_file', status: 'error', response: { security_scan: { status: 'MALWARE_DETECTED', disposition: 'discarded', persisted: false } } }] }));
  assert(scan.includes('MALWARE_DETECTED') && scan.includes('no file retained') && !scan.includes('<img'));
  const { default: ChatMessageRow } = await server.ssrLoadModule('/src/components/ChatMessageRow.jsx');
  const fallback = renderToStaticMarkup(createElement(ChatMessageRow, { role: 'assistant', content: 'Done', showFeedback: false, toolCalls: [{ tool_name: 'download_file', status: 'ok', response: { relative_url: '/api/media/openclaw/downloads/owner/test.pdf', security_scan: { status: 'clean' } } }] }));
  assert(fallback.includes('PDF attachment') && !fallback.includes('Generated image'));
  console.log('Chat table regression tests passed (Markdown, HTML, links, fences, sanitization).');
} finally { await server.close(); }
