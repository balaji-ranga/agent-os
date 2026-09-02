import React from 'react';

const CAPABILITIES = [
  { number: 1, verb: 'Sell', system: 'CRM', description: 'Manage relationships, opportunities, quotes, and orders throughout the customer lifecycle to drive revenue.', existing: true },
  { number: 2, verb: 'Operate and account', system: 'ERP', description: 'Run core business processes, transact, manage finances, assets, inventory, and record the results.', existing: true },
  { number: 3, verb: 'Organize', system: 'Org', description: 'Define the enterprise structure, operating model, locations, entities, and key organizational data.', existing: true },
  { number: 4, verb: 'Know', system: 'Knowledge', description: 'Capture, curate, and share knowledge, content, and insights to inform decisions and actions.', existing: true },
  { number: 5, verb: 'Employ', system: 'HCM', description: 'Attract, develop, engage, pay, and support people across their employee lifecycle.' },
  { number: 6, verb: 'Serve', system: 'Customer Service', description: 'Deliver customer support across channels and resolve issues to build loyalty and trust.' },
  { number: 7, verb: 'Plan', system: 'EPM', description: 'Plan, forecast, model, and analyze financial and operational performance to guide strategy and resources.' },
  { number: 8, verb: 'Market', system: 'Marketing Operations', description: 'Plan and execute marketing programs, manage campaigns, and measure impact across channels.' },
  { number: 9, verb: 'Govern', system: 'GRC', description: 'Manage risk, ensure compliance, maintain policies, and provide assurance across the enterprise.' },
  { number: 10, verb: 'Contract', system: 'Legal / CLM', description: 'Create, negotiate, manage, and analyze contracts and legal obligations across the lifecycle.' },
  { number: 11, verb: 'Build', system: 'Product and Portfolio', description: 'Define strategy, build products, and manage the portfolio from idea to value.' },
  { number: 12, verb: 'Support the company', system: 'ITSM', description: 'Deliver reliable IT services and manage incidents, changes, assets, and service performance.' },
];

const FOUNDATIONS = [
  ['Data & Information', 'Trusted, governed, secure, and accessible data powering insights and automation.'],
  ['Integration & APIs', 'Connected systems and data through standard APIs, events, and integration patterns.'],
  ['Security & Identity', 'Identity, access, privacy, and cybersecurity embedded across all capabilities.'],
  ['Analytics & Insights', 'Business intelligence, advanced analytics, and AI/ML to drive better outcomes.'],
  ['Technology Platform', 'Cloud infrastructure, platforms, and engineering enabling scalability, reliability, and innovation.'],
];

export default function CapabilityArchitecture() {
  return (
    <figure className="cap-map" aria-labelledby="cap-map-title">
      <figcaption id="cap-map-title" className="cap-map-title">
        Flolah Capability Architecture
        <span>A modern, AI-native capability model aligned to how companies create and deliver value</span>
      </figcaption>

      <div className="cap-map-legend" aria-label="Legend">
        <span><i className="cap-map-key is-existing" aria-hidden="true" /> Available in Flolah</span>
        <span><i className="cap-map-key" aria-hidden="true" /> Capability direction</span>
      </div>

      <section className="cap-map-layer" aria-labelledby="cap-domains">
        <h3 id="cap-domains">Business capabilities</h3>
        <div className="cap-map-grid">
          {CAPABILITIES.map((capability) => (
            <article key={capability.number} className={`cap-map-box${capability.existing ? ' is-existing' : ''}`}>
              <div className="cap-map-box-head">
                <b className="cap-map-number">{capability.number}</b>
                <div>
                  <strong>{capability.verb}</strong>
                  <span>{capability.system}</span>
                </div>
              </div>
              <p>{capability.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="cap-map-layer cap-map-foundations" aria-labelledby="cap-foundations">
        <h3 id="cap-foundations">Cross-cutting foundations <small>(enable all capabilities)</small></h3>
        <div>
          {FOUNDATIONS.map(([name, description]) => (
            <div className="cap-map-foundation-row" key={name}>
              <strong>{name}</strong>
              <span>{description}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="cap-map-layer cap-map-execution" aria-labelledby="cap-execution">
        <div className="cap-map-execution-title">
          <b className="cap-map-number">13</b>
          <div>
            <strong>Agents and Workflows</strong>
            <span>Execute across everything</span>
          </div>
        </div>
        <p>AI agents, workflows, and automation orchestrate work across people, systems, and data to drive efficiency, consistency, and speed at scale.</p>
        <div className="cap-map-execution-steps" aria-label="Execution cycle">
          <span>AI Agents</span>
          <span>Automation</span>
          <span>Workflows</span>
          <span>Orchestration</span>
          <span>Continuous Improvement</span>
        </div>
      </section>

      <div className="cap-map-footer">Powered by Flolah Platform · Governed, secure, and AI-native · Open by design</div>
    </figure>
  );
}
