/**
 * Unit tests for Business Discovery mode inference + research brief scoring.
 * Usage: node scripts/test-business-discover-modes.mjs
 */
import { parseDiscoverIntent, inferDiscoverModes, nextActionPrompt } from '../src/services/social-research/discover-intent.js';
import {
  buildResearchBrief,
  opportunityStars,
  websiteQuality,
  digitalPresence,
} from '../src/services/social-research/discover-score.js';

const TAMPINES = `Research dental clinics within 5 km of Tampines, Singapore.

Find up to 20 businesses using Google Business/Places and research their publicly available online presence.

For each business, identify:

Business name, location, Google rating and number of reviews
Website
Instagram and LinkedIn presence, if available
How recently they have posted on social media
Main services they promote
Any notable promotions or campaigns
Overall quality of their digital/social presence

Identify businesses that appear to have a strong business reputation but weak digital or social-media presence.

Rank the top 5 potential prospects and briefly explain why each is a good opportunity.

Use fresh information where possible. Reuse recently collected data if it is still current; otherwise refresh the source. Do not permanently track these businesses unless I ask you to.`;

let failed = 0;
function ok(cond, msg, extra) {
  if (cond) {
    console.log('OK', msg);
    return true;
  }
  failed += 1;
  console.error('FAIL', msg, extra != null ? extra : '');
  return false;
}

const parsed = parseDiscoverIntent({ intent: TAMPINES });
ok(parsed.locality.toLowerCase().includes('tampines'), 'locality Tampines', parsed.locality);
ok(parsed.business_type === 'dentist', 'type dentist', parsed.business_type);
ok(parsed.radius_km === 5, 'radius 5 km', parsed.radius_km);
ok(parsed.max_results === 20, 'max 20', parsed.max_results);
ok(parsed.modes.includes('discover') && parsed.modes.includes('research'), 'modes discover+research', parsed.modes);
ok(!parsed.modes.includes('track') && !parsed.modes.includes('act'), 'skip track/act', parsed.modes);
ok(parsed.persist === false && parsed.handoff === false, 'no persist/handoff', {
  persist: parsed.persist,
  handoff: parsed.handoff,
});
ok(/CRM/i.test(nextActionPrompt(parsed.modes)), 'next action asks CRM');

ok(
  inferDiscoverModes({ locality: 'Tampines', business_type: 'dentist' }).join(',') === 'discover,research',
  'structured Places args default to research'
);
ok(
  inferDiscoverModes({ intent: 'Find businesses near Bedok' }).join(',') === 'discover',
  'find businesses is discover-only'
);
ok(
  inferDiscoverModes({ intent: 'Tell me what changes for those gyms' }).includes('track'),
  'what changes → track'
);
ok(
  inferDiscoverModes({ intent: 'Save these 5 prospects to CRM' }).includes('act'),
  'save to CRM → act'
);

ok(websiteQuality('') === 'Poor', 'no website Poor');
ok(websiteQuality('https://www.brightsmiles.sg') === 'Good', 'own site Good');
ok(websiteQuality('https://instagram.com/clinic') === 'Poor', 'IG-only site Poor');
ok(digitalPresence({ website_quality: 'Poor', instagram: 'None', linkedin: '' }) === 'Weak', 'weak digital');
ok(opportunityStars({ rating: 4.8, user_rating_count: 620, digital_presence: 'Weak' }) === 5, 'weak digital + strong Google = 5');
ok(opportunityStars({ rating: 4.8, user_rating_count: 620, digital_presence: 'Strong' }) === 2, 'strong digital = 2');

const { brief, brief_markdown } = buildResearchBrief(
  [
    {
      name: 'Clinic A',
      rating: 4.8,
      user_rating_count: 210,
      website: 'https://clinica.example',
      instagram_status: 'Inactive',
      linkedin: '',
    },
    {
      name: 'Clinic B',
      rating: 4.9,
      user_rating_count: 620,
      website: '',
      instagram_status: 'None',
      linkedin: '',
    },
    {
      name: 'Clinic C',
      rating: 4.6,
      user_rating_count: 400,
      website: 'https://clinicc.example',
      instagram_status: 'Active',
      linkedin: 'https://linkedin.com/company/c',
      facebook: 'https://facebook.com/c',
    },
  ],
  { topN: 5, nextAction: 'Would you like me to save these 5 prospects to CRM or research them in more depth?' }
);
ok(brief.table.length === 3, 'table rows');
ok(brief.table[0].business === 'Clinic B', 'top is weak-digital Clinic B', brief.table[0]);
ok(brief.table[0].opportunity_score === 5, 'Clinic B 5 stars', brief.table[0]);
ok(/Clinic C/.test(brief_markdown) && /★/.test(brief_markdown), 'markdown table has stars');
ok(/save these 5 prospects to CRM/i.test(brief.next_action), 'CRM question');

if (failed) {
  console.error(`BUSINESS_DISCOVER_MODES_FAIL count=${failed}`);
  process.exit(1);
}
console.log('BUSINESS_DISCOVER_MODES_OK');
