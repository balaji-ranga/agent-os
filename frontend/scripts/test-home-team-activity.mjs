import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transform } from 'esbuild';
import { parseFragment } from 'parse5';

// Render the actual Home pane without mounting unrelated authenticated chat services.
const source = readFileSync(new URL('../src/pages/AgentChat.jsx', import.meta.url), 'utf8');
const pane = source.slice(source.indexOf('function HomeRightPane('), source.indexOf('export default function AgentChat('));
assert(pane.startsWith('function HomeRightPane('));
const compiled = await transform(pane, { loader: 'jsx', jsx: 'transform' });
const HomeRightPane = new Function('React', 'RobotAvatar', 'relativeTime', `${compiled.code}; return HomeRightPane;`)(
  React, () => React.createElement('span', { className: 'avatar-stub' }), () => 'recently',
);
const activity = 'Review the full company operations report, then summarize blockers and recommendations <img src=x onerror=evil()> & "follow up"';
const agents = Array.from({ length: 8 }, (_, i) => ({
  id: `agent-${i}`, name: `${String.fromCharCode(90 - i)} Agent`, activity: `${activity} ${i}`, status: 'idle',
}));
const html = renderToStaticMarkup(React.createElement(HomeRightPane, { agentActivity: agents }));
const nodes = [];
function visit(node) {
  nodes.push(node);
  for (const child of node.childNodes || []) visit(child);
}
visit(parseFragment(html));
const classNodes = (name) => nodes.filter((node) => node.attrs?.some((a) => a.name === 'class' && a.value === name));
const texts = classNodes('home-agent-act');
assert.equal(texts.length, 6, 'six latest agents shown');
assert.deepEqual(classNodes('home-agent-name').map((node) => node.childNodes[0].value), agents.slice(0, 6).map((a) => a.name),
  'preserve API recency order, not alphabetical');
for (const [i, node] of texts.entries()) {
  assert.equal(node.attrs.find((a) => a.name === 'title')?.value, agents[i].activity,
    'tooltip contains entire activity, including text hidden by CSS ellipsis');
  assert.equal(node.childNodes[0].value, agents[i].activity);
}
assert(!nodes.some((node) => node.tagName === 'img'), 'activity and tooltip safely escape HTML');
assert.match(source, /setInterval\(load, 30000\)/, 'existing 30-second snapshot refresh remains');
assert.match(renderToStaticMarkup(React.createElement(HomeRightPane, {})), /No AI employees yet/);
console.log('PASS Home Team activity rendering: API order, full activity tooltips, safe escaping, six-row limit and empty state');
