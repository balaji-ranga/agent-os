import { useState } from 'react';
import { Link } from 'react-router-dom';

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
    <div className={`flolah-arch-rank${rank.accent ? ' is-accent' : ''}`}>
      <div className="flolah-arch-rank-meta">
        <div className="flolah-arch-rank-label">{rank.label}</div>
        <div className="flolah-arch-rank-hint">{rank.hint}</div>
      </div>
      <div
        className="flolah-arch-rank-boxes"
        style={{ gridTemplateColumns: `repeat(${rank.boxes.length}, minmax(0, 1fr))` }}
      >
        {rank.boxes.map((box) => (
          <div key={box.title} className="flolah-arch-box">
            <div className="flolah-arch-box-title">{box.title}</div>
            <div className="flolah-arch-box-body">{box.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OperatingFlow() {
  return (
    <div className="flolah-arch-flow" aria-label="How your company runs">
      {OPERATING_RANKS.map((rank, i) => (
        <div key={rank.id}>
          <RankBand rank={rank} />
          {i < OPERATING_RANKS.length - 1 ? (
            <div className="flolah-arch-arrow" aria-hidden="true">
              ↓
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function CapabilityLayers() {
  return (
    <div className="flolah-arch-layers" aria-label="Components and capabilities">
      {LAYERS.map((layer) => (
        <div key={layer.kicker} className={`flolah-arch-layer${layer.accent ? ' is-accent' : ''}`}>
          <div className="flolah-arch-layer-kicker">{layer.kicker}</div>
          <div className="flolah-arch-layer-title">{layer.title}</div>
          <div className="flolah-arch-chips">
            {layer.items.map((item) => (
              <span key={item} className="flolah-arch-chip">
                {item}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CompactStrip() {
  const [open, setOpen] = useState(false);
  return (
    <section className="flolah-arch flolah-arch-compact" aria-label="How your AI company runs">
      <button
        type="button"
        className="flolah-arch-compact-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="flolah-arch-compact-line">
          <strong>How your company runs</strong>
          <span className="flolah-arch-compact-flow">
            You → COO → AI employees → Kanban / bell
          </span>
        </span>
        <span className="flolah-arch-compact-cta">{open ? 'Hide diagram' : 'Show diagram'}</span>
      </button>
      {open ? (
        <div className="flolah-arch-compact-body">
          <p className="flolah-arch-lead">
            You stay CEO. Give an outcome in plain language. The COO plans, hands work to the right AI
            employee, and brings results back on Kanban and the bell.
          </p>
          <OperatingFlow />
          <p className="flolah-arch-more">
            Full layers:{' '}
            <Link to="/org">My Org</Link>
            {' · '}
            <a href="/docs/start/how-the-company-runs/" target="_blank" rel="noreferrer">
              User guide
            </a>
          </p>
        </div>
      ) : null}
    </section>
  );
}

export default function CompanyArchitecturePanel({ variant = 'full' }) {
  const [tab, setTab] = useState('run');
  if (variant === 'compact') return <CompactStrip />;

  return (
    <section className="flolah-arch flolah-arch-full" aria-label="Company architecture">
      <div className="flolah-arch-head">
        <div>
          <h2 className="flolah-arch-h2">How this company runs</h2>
          <p className="flolah-arch-lead">
            You stay CEO. The COO is your chief of staff — not another chatbot. Named AI employees do
            the work under your supervision.
          </p>
        </div>
        <div className="flolah-arch-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'run'}
            className={tab === 'run' ? 'is-on' : ''}
            onClick={() => setTab('run')}
          >
            Operating model
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'layers'}
            className={tab === 'layers' ? 'is-on' : ''}
            onClick={() => setTab('layers')}
          >
            Components and capabilities
          </button>
        </div>
      </div>
      {tab === 'run' ? <OperatingFlow /> : <CapabilityLayers />}
      <p className="flolah-arch-more">
        Same diagrams in the public guide:{' '}
        <a href="/docs/start/how-the-company-runs/" target="_blank" rel="noreferrer">
          How the company runs
        </a>
      </p>
    </section>
  );
}
