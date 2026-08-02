/**
 * Render FloLah walkthrough slides as SVG (UI chrome + pointer callouts).
 */
import { NAV_ITEMS } from './video-tours-storyboards.js';

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function navY(label) {
  const idx = NAV_ITEMS.indexOf(label);
  const i = idx >= 0 ? idx : 0;
  return 118 + i * 34;
}

function scenePanel(scene) {
  switch (scene) {
    case 'hero':
      return `
        <rect x="250" y="120" width="960" height="430" rx="16" fill="#0f1724"/>
        <text x="730" y="290" text-anchor="middle" font-size="54" font-weight="700" fill="#f3f6fb" font-family="DejaVu Sans, Arial">FloLah</text>
        <text x="730" y="340" text-anchor="middle" font-size="22" fill="#9aa8bd" font-family="DejaVu Sans, Arial">Automate · Innovate · Elevate</text>`;
    case 'dashboard':
      return `
        <rect x="250" y="120" width="580" height="430" rx="12" fill="#121a28"/>
        <text x="270" y="150" font-size="18" fill="#9aa8bd" font-family="DejaVu Sans, Arial">Org chart</text>
        <rect x="300" y="180" width="140" height="56" rx="10" fill="#243249"/>
        <text x="370" y="214" text-anchor="middle" font-size="16" fill="#e8eef8" font-family="DejaVu Sans, Arial">COO</text>
        <rect x="280" y="280" width="110" height="48" rx="10" fill="#1e293b"/>
        <text x="335" y="310" text-anchor="middle" font-size="14" fill="#c7d2e3" font-family="DejaVu Sans, Arial">Research</text>
        <rect x="420" y="280" width="110" height="48" rx="10" fill="#1e293b"/>
        <text x="475" y="310" text-anchor="middle" font-size="14" fill="#c7d2e3" font-family="DejaVu Sans, Arial">Delivery</text>
        <line x1="370" y1="236" x2="335" y2="280" stroke="#4b5d78" stroke-width="2"/>
        <line x1="370" y1="236" x2="475" y2="280" stroke="#4b5d78" stroke-width="2"/>
        <rect x="850" y="120" width="360" height="430" rx="12" fill="#121a28"/>
        <text x="870" y="150" font-size="18" fill="#9aa8bd" font-family="DejaVu Sans, Arial">Preview</text>
        <rect x="870" y="170" width="320" height="80" rx="8" fill="#1b2536"/>
        <rect x="870" y="270" width="320" height="80" rx="8" fill="#1b2536"/>`;
    case 'orgChat':
      return `
        <rect x="250" y="120" width="420" height="430" rx="12" fill="#121a28"/>
        <text x="270" y="150" font-size="16" fill="#9aa8bd" font-family="DejaVu Sans, Arial">Agents</text>
        <rect x="270" y="170" width="380" height="52" rx="8" fill="#2a3b55" stroke="#6ea8fe" stroke-width="2"/>
        <text x="290" y="202" font-size="16" fill="#f3f6fb" font-family="DejaVu Sans, Arial">COO — Operations</text>
        <rect x="270" y="236" width="380" height="48" rx="8" fill="#1b2536"/>
        <text x="290" y="266" font-size="15" fill="#c7d2e3" font-family="DejaVu Sans, Arial">Workflow Builder</text>
        <rect x="270" y="296" width="380" height="48" rx="8" fill="#1b2536"/>
        <text x="290" y="326" font-size="15" fill="#c7d2e3" font-family="DejaVu Sans, Arial">Platform Help</text>
        <rect x="690" y="120" width="520" height="430" rx="12" fill="#0f1724"/>
        <text x="710" y="150" font-size="16" fill="#9aa8bd" font-family="DejaVu Sans, Arial">Chat</text>
        <rect x="710" y="170" width="400" height="44" rx="10" fill="#243249"/>
        <text x="730" y="198" font-size="14" fill="#dbe5f4" font-family="DejaVu Sans, Arial">CEO: Get status from the team</text>
        <rect x="780" y="230" width="400" height="60" rx="10" fill="#1b2536"/>
        <text x="800" y="265" font-size="14" fill="#dbe5f4" font-family="DejaVu Sans, Arial">COO: Standing by — opening standup…</text>
        <rect x="710" y="480" width="420" height="44" rx="8" fill="#1b2536" stroke="#3d4f6a"/>
        <text x="730" y="508" font-size="14" fill="#8ea0b8" font-family="DejaVu Sans, Arial">Message…   📎</text>`;
    case 'workflows':
      return `
        <rect x="250" y="120" width="960" height="430" rx="12" fill="#121a28"/>
        <text x="270" y="150" font-size="18" fill="#9aa8bd" font-family="DejaVu Sans, Arial">Workflows</text>
        <rect x="270" y="180" width="220" height="90" rx="12" fill="#243249" stroke="#6ea8fe" stroke-width="2"/>
        <text x="380" y="230" text-anchor="middle" font-size="16" fill="#f3f6fb" font-family="DejaVu Sans, Arial">Trigger</text>
        <rect x="560" y="180" width="220" height="90" rx="12" fill="#1e293b"/>
        <text x="670" y="230" text-anchor="middle" font-size="16" fill="#e8eef8" font-family="DejaVu Sans, Arial">Brain</text>
        <rect x="850" y="180" width="220" height="90" rx="12" fill="#1e293b"/>
        <text x="960" y="230" text-anchor="middle" font-size="16" fill="#e8eef8" font-family="DejaVu Sans, Arial">Notify</text>
        <line x1="490" y1="225" x2="560" y2="225" stroke="#6ea8fe" stroke-width="3"/>
        <line x1="780" y1="225" x2="850" y2="225" stroke="#4b5d78" stroke-width="3"/>
        <rect x="270" y="320" width="180" height="44" rx="8" fill="#3b82f6"/>
        <text x="360" y="348" text-anchor="middle" font-size="15" fill="#fff" font-family="DejaVu Sans, Arial">Publish</text>
        <rect x="470" y="320" width="180" height="44" rx="8" fill="#243249"/>
        <text x="560" y="348" text-anchor="middle" font-size="15" fill="#e8eef8" font-family="DejaVu Sans, Arial">Run</text>`;
    case 'masterData':
      return `
        <rect x="250" y="120" width="960" height="430" rx="12" fill="#121a28"/>
        <text x="270" y="150" font-size="18" fill="#9aa8bd" font-family="DejaVu Sans, Arial">Master Data</text>
        <rect x="270" y="180" width="280" height="320" rx="10" fill="#0f1724"/>
        <text x="290" y="210" font-size="15" fill="#6ea8fe" font-family="DejaVu Sans, Arial">Tables</text>
        <text x="290" y="250" font-size="15" fill="#e8eef8" font-family="DejaVu Sans, Arial">departments</text>
        <text x="290" y="280" font-size="15" fill="#9aa8bd" font-family="DejaVu Sans, Arial">job_profiles</text>
        <rect x="580" y="180" width="600" height="320" rx="10" fill="#0f1724"/>
        <text x="600" y="210" font-size="15" fill="#6ea8fe" font-family="DejaVu Sans, Arial">Documents</text>
        <rect x="600" y="230" width="540" height="50" rx="8" fill="#1b2536"/>
        <text x="620" y="262" font-size="14" fill="#e8eef8" font-family="DejaVu Sans, Arial">Platform Help — Getting started</text>
        <rect x="600" y="300" width="540" height="50" rx="8" fill="#1b2536"/>
        <text x="620" y="332" font-size="14" fill="#e8eef8" font-family="DejaVu Sans, Arial">Flolah User Guide</text>`;
    case 'kanban':
      return `
        <rect x="250" y="120" width="960" height="430" rx="12" fill="#121a28"/>
        <text x="270" y="150" font-size="18" fill="#9aa8bd" font-family="DejaVu Sans, Arial">Kanban</text>
        <rect x="270" y="180" width="280" height="320" rx="10" fill="#0f1724"/>
        <text x="290" y="210" font-size="15" fill="#9aa8bd" font-family="DejaVu Sans, Arial">Todo</text>
        <rect x="290" y="230" width="240" height="70" rx="8" fill="#243249"/>
        <rect x="580" y="180" width="280" height="320" rx="10" fill="#0f1724"/>
        <text x="600" y="210" font-size="15" fill="#9aa8bd" font-family="DejaVu Sans, Arial">In progress</text>
        <rect x="600" y="230" width="240" height="70" rx="8" fill="#2a3b55" stroke="#6ea8fe" stroke-width="2"/>
        <text x="620" y="270" font-size="14" fill="#e8eef8" font-family="DejaVu Sans, Arial">COO standup</text>
        <rect x="890" y="180" width="280" height="320" rx="10" fill="#0f1724"/>
        <text x="910" y="210" font-size="15" fill="#9aa8bd" font-family="DejaVu Sans, Arial">Done</text>`;
    case 'browser':
      return `
        <rect x="250" y="120" width="960" height="430" rx="12" fill="#121a28"/>
        <text x="270" y="150" font-size="18" fill="#9aa8bd" font-family="DejaVu Sans, Arial">Browser Session</text>
        <rect x="270" y="180" width="600" height="320" rx="10" fill="#0f1724"/>
        <text x="290" y="220" font-size="16" fill="#e8eef8" font-family="DejaVu Sans, Arial">1. Opt in · mark ready</text>
        <text x="290" y="260" font-size="16" fill="#e8eef8" font-family="DejaVu Sans, Arial">2. Capture recipe steps</text>
        <text x="290" y="300" font-size="16" fill="#e8eef8" font-family="DejaVu Sans, Arial">3. Replay with browse_* tools</text>
        <rect x="900" y="180" width="280" height="320" rx="10" fill="#0f1724"/>
        <text x="920" y="220" font-size="15" fill="#6ea8fe" font-family="DejaVu Sans, Arial">Recipes</text>
        <rect x="920" y="240" width="240" height="50" rx="8" fill="#243249"/>
        <text x="940" y="270" font-size="14" fill="#e8eef8" font-family="DejaVu Sans, Arial">login-flow</text>`;
    case 'contentExplorer':
      return `
        <rect x="250" y="120" width="960" height="430" rx="12" fill="#121a28"/>
        <text x="270" y="150" font-size="18" fill="#9aa8bd" font-family="DejaVu Sans, Arial">Content Explorer</text>
        <rect x="270" y="180" width="300" height="320" rx="10" fill="#0f1724"/>
        <text x="290" y="220" font-size="15" fill="#e8eef8" font-family="DejaVu Sans, Arial">inbound/</text>
        <text x="290" y="255" font-size="15" fill="#e8eef8" font-family="DejaVu Sans, Arial">generated/</text>
        <text x="290" y="290" font-size="15" fill="#6ea8fe" font-family="DejaVu Sans, Arial">media/</text>
        <rect x="600" y="180" width="580" height="320" rx="10" fill="#0f1724"/>
        <rect x="620" y="210" width="540" height="60" rx="8" fill="#1b2536"/>
        <text x="640" y="245" font-size="14" fill="#e8eef8" font-family="DejaVu Sans, Arial">video-export.mp4 · Download</text>`;
    case 'apiKeys':
      return `
        <rect x="250" y="120" width="960" height="430" rx="12" fill="#121a28"/>
        <text x="270" y="150" font-size="18" fill="#9aa8bd" font-family="DejaVu Sans, Arial">API Keys vault</text>
        <rect x="270" y="190" width="900" height="70" rx="10" fill="#1b2536" stroke="#6ea8fe" stroke-width="2"/>
        <text x="290" y="232" font-size="16" fill="#e8eef8" font-family="DejaVu Sans, Arial">OPENAI_BYOK · •••••••• · Save</text>
        <rect x="270" y="280" width="900" height="70" rx="10" fill="#1b2536"/>
        <text x="290" y="322" font-size="16" fill="#e8eef8" font-family="DejaVu Sans, Arial">BRAVE_SEARCH_BYOK · optional</text>`;
    case 'channels':
      return `
        <rect x="250" y="120" width="960" height="430" rx="12" fill="#121a28"/>
        <text x="270" y="150" font-size="18" fill="#9aa8bd" font-family="DejaVu Sans, Arial">Agent Channels</text>
        <rect x="270" y="190" width="420" height="280" rx="12" fill="#0f1724" stroke="#6ea8fe" stroke-width="2"/>
        <text x="290" y="240" font-size="20" fill="#f3f6fb" font-family="DejaVu Sans, Arial">WhatsApp</text>
        <text x="290" y="280" font-size="15" fill="#9aa8bd" font-family="DejaVu Sans, Arial">1. Vault token</text>
        <text x="290" y="315" font-size="15" fill="#9aa8bd" font-family="DejaVu Sans, Arial">2. Bind agent</text>
        <text x="290" y="350" font-size="15" fill="#9aa8bd" font-family="DejaVu Sans, Arial">3. Test inbound</text>
        <rect x="720" y="190" width="420" height="280" rx="12" fill="#0f1724"/>
        <text x="740" y="240" font-size="20" fill="#f3f6fb" font-family="DejaVu Sans, Arial">Slack</text>`;
    case 'efficiency':
      return `
        <rect x="250" y="120" width="960" height="430" rx="12" fill="#121a28"/>
        <text x="270" y="150" font-size="18" fill="#9aa8bd" font-family="DejaVu Sans, Arial">Efficiency View</text>
        <rect x="270" y="180" width="200" height="44" rx="8" fill="#3b82f6"/>
        <text x="370" y="208" text-anchor="middle" font-size="15" fill="#fff" font-family="DejaVu Sans, Arial">Org</text>
        <rect x="490" y="180" width="200" height="44" rx="8" fill="#243249"/>
        <text x="590" y="208" text-anchor="middle" font-size="15" fill="#e8eef8" font-family="DejaVu Sans, Arial">Department</text>
        <rect x="710" y="180" width="200" height="44" rx="8" fill="#243249"/>
        <text x="810" y="208" text-anchor="middle" font-size="15" fill="#e8eef8" font-family="DejaVu Sans, Arial">Agent</text>
        <rect x="270" y="250" width="900" height="120" rx="12" fill="#0f1724"/>
        <text x="300" y="310" font-size="28" fill="#f3f6fb" font-family="DejaVu Sans, Arial">Tokens MTD  ·  Error %  ·  Storage MB</text>`;
    case 'avatars':
      return `
        <rect x="250" y="120" width="960" height="430" rx="12" fill="#121a28"/>
        <text x="270" y="150" font-size="18" fill="#9aa8bd" font-family="DejaVu Sans, Arial">Virtual Room</text>
        <circle cx="520" cy="320" r="70" fill="#2a3b55" stroke="#6ea8fe" stroke-width="3"/>
        <text x="520" y="328" text-anchor="middle" font-size="16" fill="#e8eef8" font-family="DejaVu Sans, Arial">Avatar</text>
        <rect x="720" y="220" width="420" height="220" rx="12" fill="#0f1724"/>
        <text x="740" y="270" font-size="15" fill="#e8eef8" font-family="DejaVu Sans, Arial">@COO status please</text>
        <text x="740" y="320" font-size="15" fill="#9aa8bd" font-family="DejaVu Sans, Arial">Published slug /p/vr/…</text>`;
    case 'profile':
      return `
        <rect x="250" y="120" width="960" height="430" rx="12" fill="#121a28"/>
        <text x="270" y="150" font-size="18" fill="#9aa8bd" font-family="DejaVu Sans, Arial">Profile</text>
        <rect x="270" y="190" width="600" height="60" rx="10" fill="#1b2536"/>
        <text x="290" y="228" font-size="16" fill="#e8eef8" font-family="DejaVu Sans, Arial">Name · email · MFA</text>
        <rect x="270" y="270" width="600" height="60" rx="10" fill="#1b2536" stroke="#6ea8fe" stroke-width="2"/>
        <text x="290" y="308" font-size="16" fill="#e8eef8" font-family="DejaVu Sans, Arial">Chat provider + model</text>
        <rect x="270" y="350" width="600" height="60" rx="10" fill="#1b2536"/>
        <text x="290" y="388" font-size="16" fill="#e8eef8" font-family="DejaVu Sans, Arial">Retention days</text>`;
    case 'onboarding':
      return `
        <rect x="250" y="120" width="960" height="430" rx="12" fill="#121a28"/>
        <text x="270" y="150" font-size="18" fill="#9aa8bd" font-family="DejaVu Sans, Arial">Onboarding Helper</text>
        <rect x="270" y="180" width="560" height="320" rx="12" fill="#0f1724"/>
        <text x="290" y="230" font-size="15" fill="#e8eef8" font-family="DejaVu Sans, Arial">Chat: purpose → vision → goals</text>
        <rect x="290" y="260" width="200" height="44" rx="8" fill="#3b82f6"/>
        <text x="390" y="288" text-anchor="middle" font-size="14" fill="#fff" font-family="DejaVu Sans, Arial">Confirm</text>
        <rect x="860" y="180" width="320" height="320" rx="12" fill="#0f1724"/>
        <text x="880" y="230" font-size="15" fill="#9aa8bd" font-family="DejaVu Sans, Arial">Steps</text>
        <text x="880" y="270" font-size="14" fill="#6ea8fe" font-family="DejaVu Sans, Arial">✓ Purpose</text>
        <text x="880" y="300" font-size="14" fill="#e8eef8" font-family="DejaVu Sans, Arial">5. Strategic</text>`;
    case 'cta':
      return `
        <rect x="250" y="120" width="960" height="430" rx="16" fill="#0f1724"/>
        <text x="730" y="300" text-anchor="middle" font-size="36" font-weight="700" fill="#f3f6fb" font-family="DejaVu Sans, Arial">Next up in the playlist</text>
        <text x="730" y="350" text-anchor="middle" font-size="20" fill="#9aa8bd" font-family="DejaVu Sans, Arial">User menu → Help → Video Tours</text>`;
    default:
      return `<rect x="250" y="120" width="960" height="430" rx="12" fill="#121a28"/>`;
  }
}

function pointerSvg(slide) {
  if (!slide?.pointer?.label) return '';
  const target = slide.pointer.target || 'main';
  let cx = 900;
  let cy = 280;
  if (target === 'nav') {
    cx = 210;
    cy = navY(slide.nav || 'Dashboard') + 12;
  } else if (target === 'chat') {
    cx = 980;
    cy = 300;
  } else if (target === 'avatar') {
    cx = 1180;
    cy = 48;
  } else if (target === 'main') {
    cx = 720;
    cy = 260;
  }
  const label = esc(slide.pointer.label);
  const lw = Math.min(280, 24 + label.length * 9);
  return `
    <circle cx="${cx}" cy="${cy}" r="18" fill="#f59e0b" stroke="#fff" stroke-width="3"/>
    <text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="16" font-weight="700" fill="#111" font-family="DejaVu Sans, Arial">➜</text>
    <rect x="${cx + 28}" y="${cy - 22}" width="${lw}" height="40" rx="8" fill="#f59e0b"/>
    <text x="${cx + 40}" y="${cy + 5}" font-size="16" font-weight="700" fill="#111" font-family="DejaVu Sans, Arial">${label}</text>`;
}

export function renderSlideSvg(slide, meta = {}) {
  const title = esc(meta.title || 'Video Tour');
  const number = String(meta.number || '').padStart(2, '0');
  const heading = esc(slide.heading || title);
  const caption = esc(slide.caption || '');
  const bullets = (slide.bullets || []).map((b) => esc(b));
  const activeNav = slide.nav || null;

  const navRects = NAV_ITEMS.map((label) => {
    const y = navY(label);
    const active = activeNav === label;
    return `
      <rect x="16" y="${y}" width="200" height="30" rx="6" fill="${active ? '#3b82f6' : '#152033'}" ${active ? 'stroke="#93c5fd" stroke-width="2"' : ''}/>
      <text x="28" y="${y + 20}" font-size="14" fill="${active ? '#fff' : '#c7d2e3'}" font-family="DejaVu Sans, Arial">${esc(label)}</text>`;
  }).join('');

  const bulletText = bullets
    .map((b, i) => `<text x="270" y="${500 + i * 22}" font-size="15" fill="#c7d2e3" font-family="DejaVu Sans, Arial">• ${b}</text>`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#0b1220"/>
  <rect x="0" y="0" width="1280" height="72" fill="#111827"/>
  <text x="24" y="46" font-size="24" font-weight="700" fill="#f3f6fb" font-family="DejaVu Sans, Arial">FloLah</text>
  <text x="130" y="46" font-size="16" fill="#9aa8bd" font-family="DejaVu Sans, Arial">Video Tours · ${number}</text>
  <circle cx="1200" cy="36" r="18" fill="#3b82f6"/>
  <text x="1200" y="42" text-anchor="middle" font-size="14" fill="#fff" font-family="DejaVu Sans, Arial">CE</text>
  <rect x="0" y="72" width="232" height="560" fill="#0f172a"/>
  <text x="24" y="100" font-size="12" fill="#64748b" font-family="DejaVu Sans, Arial">NAVIGATION</text>
  ${navRects}
  ${scenePanel(slide.scene)}
  <text x="270" y="110" font-size="22" font-weight="700" fill="#f8fafc" font-family="DejaVu Sans, Arial">${heading}</text>
  ${bulletText}
  ${pointerSvg(slide)}
  <rect x="0" y="640" width="1280" height="80" fill="#020617"/>
  <text x="40" y="690" font-size="22" fill="#e2e8f0" font-family="DejaVu Sans, Arial">${caption}</text>
</svg>`;
}