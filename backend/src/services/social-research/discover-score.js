/**
 * Rank local businesses: strong Google reputation + weak digital presence = higher opportunity.
 */

const PROMO_RE = /\b(promo|promotion|discount|offer|campaign|sale|% off|voucher)\b/i;
const SOCIAL_HOST_RE = /instagram\.com|facebook\.com|linkedin\.com|linktr\.ee|bit\.ly|wa\.me/i;

export function websiteQuality(url) {
  const u = String(url || '').trim();
  if (!u) return 'Poor';
  try {
    const host = new URL(u.includes('://') ? u : `https://${u}`).hostname;
    if (!host || SOCIAL_HOST_RE.test(host)) return 'Poor';
    return 'Good';
  } catch {
    return 'Poor';
  }
}

export function instagramLabel(status) {
  const s = String(status || '').trim();
  if (/^active$/i.test(s)) return 'Active';
  if (/^inactive$/i.test(s)) return 'Inactive';
  if (/^none$/i.test(s) || !s) return 'None';
  return s;
}

export function digitalPresence({ website_quality, instagram, linkedin, facebook }) {
  const site = website_quality === 'Good';
  const ig = instagram === 'Active';
  const igSome = instagram === 'Active' || instagram === 'Inactive';
  const li = Boolean(linkedin);
  const fb = Boolean(facebook);
  if (site && ig && (li || fb)) return 'Strong';
  if (site && (igSome || li || fb)) return 'Medium';
  if (site && !igSome && !li) return 'Medium';
  return 'Weak';
}

export function opportunityStars({ rating, user_rating_count, digital_presence }) {
  const r = Number(rating);
  const n = Number(user_rating_count) || 0;
  const strongRep = Number.isFinite(r) && r >= 4.3 && n >= 40;
  const decentRep = Number.isFinite(r) && r >= 4.0 && n >= 15;
  const digital = String(digital_presence || 'Weak');
  let stars = 1;
  if (strongRep && digital === 'Weak') stars = 5;
  else if (strongRep && digital === 'Medium') stars = 3;
  else if (strongRep && digital === 'Strong') stars = 2;
  else if (decentRep && digital === 'Weak') stars = 4;
  else if (decentRep && digital === 'Medium') stars = 2;
  else if (decentRep && digital === 'Strong') stars = 1;
  else if (digital === 'Weak') stars = 2;
  else stars = 1;
  return stars;
}

export function starBar(n) {
  const k = Math.min(5, Math.max(1, Number(n) || 1));
  return '★'.repeat(k) + '☆'.repeat(5 - k);
}

export function googleCell(place) {
  const r = place.rating != null && place.rating !== '' ? Number(place.rating).toFixed(1) : '—';
  const n = Number(place.user_rating_count || place.userRatingCount || 0);
  return n ? `${r} / ${n}` : String(r);
}

function clip(s, n = 180) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  return t.slice(0, n - 1) + '…';
}

export function extractServicesAndPromos(snippets = []) {
  const texts = (snippets || []).map((x) => String(x || '').trim()).filter(Boolean);
  const promotions = [];
  const services = [];
  for (const t of texts) {
    if (PROMO_RE.test(t)) promotions.push(clip(t, 140));
    else services.push(clip(t, 140));
  }
  return {
    main_services: services.slice(0, 3).join('; ') || '',
    promotions: promotions.slice(0, 2).join('; ') || '',
  };
}

export function scorePlace(place) {
  const igUrl =
    place.instagram_url ||
    (/instagram\.com/i.test(String(place.instagram || '')) ? String(place.instagram) : '');
  const website_quality = websiteQuality(place.website);
  const instagram = instagramLabel(
    place.instagram_status || (igUrl ? 'Inactive' : 'None')
  );
  const digital_presence = digitalPresence({
    website_quality,
    instagram,
    linkedin: place.linkedin || place.linkedin_url,
    facebook: place.facebook || place.facebook_url,
  });
  const opportunity = opportunityStars({
    rating: place.rating,
    user_rating_count: place.user_rating_count,
    digital_presence,
  });
  return {
    website_quality,
    instagram,
    digital_presence,
    opportunity,
    opportunity_stars: starBar(opportunity),
    instagram_url: igUrl,
  };
}

export function buildResearchBrief(places, { topN = 5, nextAction = '' } = {}) {
  const ranked = [...(places || [])]
    .map((p) => {
      const scored = scorePlace(p);
      const instagram_url =
        scored.instagram_url ||
        p.instagram_url ||
        (/instagram\.com/i.test(String(p.instagram || '')) ? String(p.instagram) : '');
      return { ...p, instagram_url, ...scored };
    })
    .sort((a, b) => {
      if (b.opportunity !== a.opportunity) return b.opportunity - a.opportunity;
      const ar = Number(a.rating) || 0;
      const br = Number(b.rating) || 0;
      if (br !== ar) return br - ar;
      return (Number(b.user_rating_count) || 0) - (Number(a.user_rating_count) || 0);
    });

  const table = ranked.map((p) => ({
    business: p.name || p.business_name || '',
    google: googleCell(p),
    website: p.website_quality,
    instagram: p.instagram,
    digital_presence: p.digital_presence,
    opportunity: p.opportunity_stars,
    opportunity_score: p.opportunity,
  }));

  const top = ranked.slice(0, Math.min(Math.max(Number(topN) || 5, 1), 10));
  const top_prospects = top.map((p, i) => ({
    rank: i + 1,
    business: p.name || p.business_name || '',
    google: googleCell(p),
    website: p.website_quality,
    instagram: p.instagram,
    linkedin: p.has_linkedin || Boolean(p.linkedin) ? 'Present' : 'None',
    digital_presence: p.digital_presence,
    opportunity: p.opportunity_stars,
    why: reasonFor(p),
    website_url: p.website || '',
    instagram_url: p.instagram_url || p.instagram || '',
    linkedin_url: p.linkedin || '',
    main_services: p.main_services || '',
    promotions: p.promotions || '',
    last_posted: p.last_posted || p.instagram_recency || '',
  }));

  const lead = top[0] || null;
  const top_opportunity = lead
    ? {
        business: lead.name || lead.business_name || '',
        reasoning: reasonFor(lead, { verbose: true }),
      }
    : null;

  const brief = {
    table,
    top_prospects,
    top_opportunity,
    next_action: nextAction,
  };
  return { ranked, brief, brief_markdown: formatBriefMarkdown(brief) };
}

function reasonFor(p, { verbose = false } = {}) {
  const name = p.name || p.business_name || 'This business';
  const google = googleCell(p);
  const ig = instagramLabel(p.instagram);
  const site = p.website_quality || websiteQuality(p.website);
  const digital = p.digital_presence || 'Weak';
  const base = `${name} has a strong local reputation (${google}) but ${digital.toLowerCase()} digital presence (website ${site}, Instagram ${ig}).`;
  if (!verbose) {
    if (digital === 'Weak' || digital === 'Medium') {
      return `${base} Good fit for social-content automation and campaign management.`;
    }
    return `${base} Less whitespace than weaker-digital peers.`;
  }
  return (
    `${base} Limited Instagram activity and little current promotional content suggest an opportunity ` +
    `for social-content automation and campaign management.`
  );
}

export function formatBriefMarkdown(brief) {
  const rows = brief?.table || [];
  const lines = [
    '| Business | Google | Website | Instagram | Digital Presence | Opportunity |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.business || ''} | ${r.google || ''} | ${r.website || ''} | ${r.instagram || ''} | ${r.digital_presence || ''} | ${r.opportunity || ''} |`
    );
  }
  const top = brief?.top_opportunity;
  if (top?.business) {
    lines.push('', `**Top opportunity: ${top.business}**`, '', top.reasoning || '');
  }
  const prospects = brief?.top_prospects || [];
  if (prospects.length) {
    lines.push('', '**Top prospects**');
    for (const p of prospects) {
      lines.push(`${p.rank}. **${p.business}** (${p.google}) — ${p.why}`);
    }
  }
  if (brief?.next_action) {
    lines.push('', brief.next_action);
  }
  return lines.join('\n');
}

export function isCacheFresh(existing, ttlDays = 7) {
  const raw = existing?.researched_at || existing?.discovered_at || '';
  if (!raw) return false;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return false;
  const ttl = Math.min(Math.max(Number(ttlDays) || 7, 1), 90) * 24 * 60 * 60 * 1000;
  return Date.now() - t < ttl;
}

export function parseCachedResearch(existing) {
  const raw = existing?.research_json;
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
