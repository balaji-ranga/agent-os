import React from 'react';
import architecture from './company-os-architecture.json';
import './company-os-architecture.css';

export default function CompanyOSArchitecture() {
  const nested = index => index >= architecture.layers.length ? null : <div className={`os-layer os-${architecture.layers[index].id}`}><h3>{architecture.layers[index].title}</h3><p>{architecture.layers[index].details}</p>{architecture.layers[index].more && <p>{architecture.layers[index].more}</p>}{nested(index + 1)}</div>;
  return <figure className="os-architecture" aria-label="The Flolah execution architecture">
    <figcaption>Flolah — AI-native Company OS<span>Generalized agentic operating architecture</span></figcaption>
    <div className="os-stack">{nested(0)}</div>
    <div className="os-foundation"><strong>{architecture.foundation.title}</strong><p>{architecture.foundation.details}</p><div className="os-capabilities">{architecture.foundation.capabilities.map(capability=><span key={capability}>{capability}</span>)}</div></div>
    <p className="os-caption">{architecture.foundation.note}</p>
  </figure>;
}
