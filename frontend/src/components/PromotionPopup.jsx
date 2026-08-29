import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import './PromotionPopup.css';

function Block({ block }) {
  if (block.type === 'heading') return <h2>{block.text}</h2>;
  if (block.type === 'paragraph' || block.type === 'disclosure') return <p className={block.type === 'disclosure' ? 'promotion-disclosure' : ''}>{block.text}</p>;
  if (block.type === 'image') return <img src={block.url} alt={block.alt || ''} />;
  if (block.type === 'video') return <video controls playsInline src={block.url}>{block.text}</video>;
  if (block.type === 'audio') return <audio controls src={block.url}>{block.text}</audio>;
  if (block.type === 'cta') return <a className="promotion-cta" href={block.url} target="_blank" rel="noopener noreferrer">{block.label || block.text || 'Learn more'}</a>;
  return null;
}

export default function PromotionPopup({ enabled = true }) {
  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading] = useState(false);
  const sessionKey = useRef(`session-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const loadNext = useCallback(() => {
    if (!enabled) return Promise.resolve();
    setLoading(true);
    return api.promotionsEligible().then((r) => setCampaign(r.campaign || null)).catch(() => setCampaign(null)).finally(() => setLoading(false));
  }, [enabled]);
  const eventFor = useCallback((item, type, metadata = {}) => item && api.promotionsEvent(item.id, { event_type: type, idempotency_key: `${sessionKey.current}:${item.id}:${type}`, metadata }).catch(() => {}), []);
  useEffect(() => { loadNext(); }, [loadNext]);
  useEffect(() => { if (!campaign) return undefined; eventFor(campaign, 'impression'); const timer = setTimeout(() => eventFor(campaign, 'viewable'), 2000); return () => clearTimeout(timer); }, [campaign?.id, eventFor]);
  if (!campaign) return null;
  const close = async (type) => { const current = campaign; setCampaign(null); await eventFor(current, type); await loadNext(); };
  return <div className="promotion-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && close('dismissed')}>
    <section className="promotion-dialog" role="dialog" aria-modal="true" aria-labelledby="promotion-title">
      <button className="promotion-close" type="button" onClick={() => close('dismissed')} aria-label="Close announcement">×</button>
      <div className="promotion-sponsor">Flolah announcement · {campaign.advertiser}</div>
      <div id="promotion-title">{campaign.blocks.map((b, i) => <div key={`${b.type}-${i}`} onClick={() => b.type === 'cta' && eventFor(campaign, 'cta_clicked', { url: b.url })}><Block block={b} /></div>)}</div>
      <p className="promotion-disclosure">{campaign.disclosure}</p>
      <div className="promotion-actions"><button type="button" disabled={loading} onClick={() => { eventFor(campaign, 'expanded_read'); close('dismissed'); }}>Done</button>{campaign.allow_suppress && <button type="button" className="secondary" disabled={loading} onClick={() => close('suppressed_by_user')}>Don&apos;t show again</button>}</div>
    </section>
  </div>;
}
