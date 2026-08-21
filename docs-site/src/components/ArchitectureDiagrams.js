import React, { useState } from 'react';

const OPERATING_RANKS = [
  {
    id: 'you',
    label: 'You',
    hint: 'Stay in charge',
    accent: true,
    boxes: [{ title: 'Human CEO', body: 'Decide, approve, teach the company' }],
  },
  {
    id: 'direct',
    label: 'Direction',
    hint: 'Plain language',
    boxes: [
      { title: 'Home chat', body: 'COO selected by default' },
      { title: 'Scheduled goals', body: 'Recurring outcomes' },
      { title: 'Broadcast', body: 'Same ask to many' },
      { title: 'Company setup', body: 'Who we are' },
    ],
  },
  {
    id: 'coo',
    label: 'COO',
    hint: 'Chief of staff',
    accent: true,
    boxes: [
      {
        title: 'Plan · match purpose · Kanban · track',
        body: 'Routes specialty work; keeps goals, standups, and status itself',
      },
    ],
  },
  {
    id: 'team',
    label: 'AI employees',
    hint: 'Named roles',
    boxes: [
      { title: 'Platform Help', body: 'How-to from the guide' },
      { title: 'Workflow Builder', body: 'Build or repair graphs' },
      { title: 'CRM / ERP SMEs', body: 'Maker then Checker' },
      { title: 'Specialists', body: 'Research, content, discovery' },
    ],
  },
  {
    id: 'systems',
    label: 'Systems',
    hint: 'Only what you granted',
    boxes: [
      { title: 'Knowledge', body: 'Tables, docs, search' },
      { title: 'Tools & Connectors', body: 'Catalog + business apps' },
      { title: 'Workflows', body: 'Repeatable capability' },
      { title: 'CRM · ERP · Browser · Channels', body: 'Live systems' },
    ],
  },
  {
    id: 'see',
    label: 'You see it',
    hint: 'Supervise',
    accent: true,
    boxes: [
      { title: 'Kanban', body: 'Work and artifacts' },
      { title: 'Digest / Workspace', body: 'Pulse and open tasks' },
      { title: 'Bell', body: 'Results and alerts' },
      { title: 'Approvals', body: 'Gates on Kanban' },
    ],
  },
];

const LAYERS = [
  {
    kicker: 'L7 · Experience',
    title: 'What you open every day',
    accent: true,
    items: ['Home chat (COO)', 'Digest', 'Workspace', 'My Org', 'Kanban', 'Efficiency / OEI', 'Virtual Rooms'],
  },
  {
    kicker: 'L6 · Direct & supervise',
    title: 'How work is assigned and watched',
    items: ['COO routing', 'Scheduled goals', 'Standups', 'Broadcast', 'Maker / Checker', 'CEO approvals', 'Bell'],
  },
  {
    kicker: 'L5 · Company OS primitives',
    title: 'The nouns of an AI-native company',
    accent: true,
    items: ['People', 'Employees', 'Departments', 'Knowledge', 'Tools', 'Policies', 'Workflows', 'Tasks', 'Approvals', 'Memory'],
  },
  {
    kicker: 'L4 · Capabilities',
    title: 'What employees can actually do',
    items: ['Content tools', 'Connectors', 'MCP', 'Browser Session', 'CRM / ERP', 'Slack / WhatsApp / Voice', 'Speech'],
  },
  {
    kicker: 'L3 · Compose & productize',
    title: 'Turn a capability into a repeatable service',
    items: ['Visual workflows', 'Workflow Builder', 'Job pipeline', 'AgentExchange', 'Download for Windows', 'IBKR pack'],
  },
  {
    kicker: 'L2 · Governance',
    title: 'Stay isolated and in control',
    items: ['Entitlements', 'API Keys / BYOK', 'Policies', 'Budgets', 'Rate limits', 'IP allowlists', 'A2A Deny all'],
  },
  {
    kicker: 'L1 · Runtime',
    title: 'The operating system under the company',
    items: ['AgentSystem', 'Flolah APIs', 'Workflow runner', 'Schedulers', 'Tenant data', 'Knowledge search'],
  },
];

function RankBand({ rank }) {
  return (
    <div className={`docs-arch-rank${rank.accent ? ' is-accent' : ''}`}>
      <div>
        <div className="docs-arch-rank-label">{rank.label}</div>
        <div className="docs-arch-rank-hint">{rank.hint}</div>
      </div>
      <div
        className="docs-arch-rank-boxes"
        style={{ gridTemplateColumns: `repeat(${rank.boxes.length}, minmax(0, 1fr))` }}
      >
        {rank.boxes.map((box) => (
          <div key={box.title} className="docs-arch-box">
            <div className="docs-arch-box-title">{box.title}</div>
            <div className="docs-arch-box-body">{box.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ArchitectureDiagrams() {
  const [tab, setTab] = useState('run');
  return (
    <div className="docs-arch">
      <div className="docs-arch-tabs" role="tablist">
        <button
          type="button"
          className={tab === 'run' ? 'is-on' : ''}
          onClick={() => setTab('run')}
        >
          Operating model
        </button>
        <button
          type="button"
          className={tab === 'layers' ? 'is-on' : ''}
          onClick={() => setTab('layers')}
        >
          Components and capabilities
        </button>
      </div>
      {tab === 'run' ? (
        <div>
          {OPERATING_RANKS.map((rank, i) => (
            <div key={rank.id}>
              <RankBand rank={rank} />
              {i < OPERATING_RANKS.length - 1 ? (
                <div className="docs-arch-arrow" aria-hidden="true">
                  ↓
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="docs-arch-layers">
          {LAYERS.map((layer) => (
            <div key={layer.kicker} className={`docs-arch-layer${layer.accent ? ' is-accent' : ''}`}>
              <div className="docs-arch-layer-kicker">{layer.kicker}</div>
              <div className="docs-arch-layer-title">{layer.title}</div>
              <div className="docs-arch-chips">
                {layer.items.map((item) => (
                  <span key={item} className="docs-arch-chip">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
