import React from 'react';

const CAPABILITIES = [
  { verb: 'Sell', system: 'CRM', existing: true },
  { verb: 'Market', system: 'Marketing Operations' },
  { verb: 'Operate & account', system: 'ERP', existing: true },
  { verb: 'Plan', system: 'EPM' },
  { verb: 'Employ', system: 'HCM / HRIS' },
  { verb: 'Serve', system: 'Customer Service' },
  { verb: 'Build', system: 'Product & Portfolio' },
  { verb: 'Support the company', system: 'ITSM' },
  { verb: 'Govern', system: 'GRC' },
  { verb: 'Contract', system: 'Legal / CLM' },
];

const OUTCOMES = ['Grow revenue', 'Deliver customer value', 'Control risk', 'Scale the company'];

function Capability({ verb, system, existing = false }) {
  return (
    <div className={`cap-map-box${existing ? ' is-existing' : ''}`}>
      <strong>{verb}</strong>
      <span>{system}</span>
    </div>
  );
}

export default function CapabilityArchitecture() {
  return (
    <figure className="cap-map" aria-labelledby="cap-map-title">
      <figcaption id="cap-map-title" className="cap-map-title">
        Flolah Company OS — capability architecture
      </figcaption>

      <div className="cap-map-legend" aria-label="Legend">
        <span><i className="cap-map-key is-existing" aria-hidden="true" /> Exists in Flolah</span>
        <span><i className="cap-map-key" aria-hidden="true" /> Future capability</span>
      </div>

      <section className="cap-map-layer" aria-labelledby="cap-outcomes">
        <h3 id="cap-outcomes">Company outcomes</h3>
        <div className="cap-map-outcomes">
          {OUTCOMES.map((outcome) => <div key={outcome}>{outcome}</div>)}
        </div>
      </section>

      <div className="cap-map-arrow" aria-hidden="true">↑</div>

      <section className="cap-map-layer" aria-labelledby="cap-domains">
        <h3 id="cap-domains">Business capability domains</h3>
        <div className="cap-map-grid">
          {CAPABILITIES.map((capability) => <Capability key={capability.system} {...capability} />)}
        </div>
      </section>

      <div className="cap-map-arrow" aria-hidden="true">↑ operates across every business domain ↑</div>

      <section className="cap-map-layer" aria-labelledby="cap-engine">
        <h3 id="cap-engine">AI operating engine</h3>
        <div className="cap-map-engine">
          <div className="cap-map-box is-existing">
            <strong>Agents</strong>
            <span>Own outcomes · reason · delegate · learn</span>
          </div>
          <b aria-label="combined with">＋</b>
          <div className="cap-map-box is-existing">
            <strong>Workflows</strong>
            <span>Execute · integrate · approve · recover</span>
          </div>
        </div>
      </section>

      <div className="cap-map-arrow" aria-hidden="true">↑</div>

      <section className="cap-map-layer" aria-labelledby="cap-foundation">
        <h3 id="cap-foundation">Company context foundation</h3>
        <div className="cap-map-foundation">
          <Capability verb="Organize" system="Org" existing />
          <Capability verb="Know" system="Knowledge" existing />
        </div>
      </section>
    </figure>
  );
}
