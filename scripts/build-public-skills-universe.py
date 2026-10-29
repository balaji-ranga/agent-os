"""Generate the public directory from default-published catalog metadata only."""
import html
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
catalog = json.loads((root / 'skills-catalog/catalog.json').read_text(encoding='utf-8'))
skills = sorted((s for s in catalog['skills'] if s.get('publish_by_default') is True), key=lambda s: s['name'])
escape = html.escape
categories = sorted({s['category'] for s in skills})
cards = []
for skill in skills:
    slug = skill['slug']
    assert slug and all(c.isalnum() or c == '-' for c in slug)
    source = 'https://github.com/balaji-ranga/agent-os/tree/main/skills-catalog/' + slug
    required = skill.get('required_tools', [])
    capabilities = ', '.join(required) if required else 'Review the skill source for prerequisites.'
    cards.append(f'''<article class="card" data-category="{escape(skill['category'], quote=True)}">
      <span class="category">{escape(skill['category'])}</span>
      <h2>{escape(skill['name'])}</h2><p>{escape(skill['description'])}</p>
      <details><summary>Required capabilities</summary><p>{escape(capabilities)}</p></details>
      <div class="license">{escape(skill.get('provenance', {}).get('license', 'See source license'))}</div>
      <a href="{escape(source, quote=True)}" target="_blank" rel="noopener noreferrer">Review skill source ↗</a>
    </article>''')
options = ''.join(f'<option value="{escape(c, quote=True)}">{escape(c)}</option>' for c in categories)
page = '''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Skills Universe · Flolah Open Agents Ecosystem</title>
<meta name="description" content="Explore reusable Flolah agent skills, their source, licenses and required capabilities.">
<link rel="icon" href="/assets/flolah-mark.png">
<style>
:root{--ink:#17233c;--muted:#53647d;--blue:#2f68ff;--line:#dce4ef}*{box-sizing:border-box}body{margin:0;color:var(--ink);background:linear-gradient(145deg,#eef4ff,#fbfaf6 45%,#ecf9f5);font-family:Inter,system-ui,sans-serif;line-height:1.6}header,main,footer{max-width:1180px;margin:auto;padding:24px}header{display:flex;justify-content:space-between;gap:20px;align-items:center;border-bottom:1px solid var(--line)}header a,footer a{color:var(--ink)}.brand{font-weight:800;text-decoration:none}.brand img{width:32px;vertical-align:middle;margin-right:8px}header nav{display:flex;gap:20px;flex-wrap:wrap}h1{font-size:clamp(3rem,7vw,5.4rem);letter-spacing:-.055em;line-height:1.05;margin:24px 0}.eyebrow,.category{text-transform:uppercase;letter-spacing:.1em;font-size:.72rem;font-weight:800;color:#3555a7}.intro{padding:40px 0 20px;max-width:790px}.intro>p{color:var(--muted);font-size:1.12rem}.controls{display:flex;gap:12px;flex-wrap:wrap;margin-top:24px}input,select{font:inherit;min-height:48px;border:1px solid #a9b7cb;border-radius:12px;background:white;padding:10px 14px;color:var(--ink)}input{flex:1;min-width:200px}label{display:block;font-size:.8rem;font-weight:700}.search{flex:1;min-width:220px}.search input{width:100%}a{color:#2654cd}a:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #168879;outline-offset:3px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin:24px 0 48px}.card{padding:25px;border:1px solid var(--line);border-radius:20px;background:#fff;display:flex;flex-direction:column;overflow-wrap:anywhere}.card h2{font-size:1.3rem;line-height:1.25;margin:14px 0 8px}.card p{font-size:.93rem;color:var(--muted)}.card>a{font-weight:750;margin-top:auto;padding-top:18px}.license{font-size:.76rem;color:var(--muted);margin-top:18px}summary{cursor:pointer;font-size:.85rem}details p{font-size:.8rem}.notice{padding:20px 24px;border:1px solid var(--line);border-radius:16px;background:#edf3fd;font-size:.9rem}.notice p{margin:0}#summary{color:var(--muted)}[hidden]{display:none!important}footer{font-size:.85rem;border-top:1px solid var(--line)}@media(max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.grid{grid-template-columns:1fr}header{align-items:flex-start;flex-direction:column}main{padding:18px}.controls{flex-direction:column}select{width:100%}}
</style></head><body>
<header><a class="brand" href="/"><img src="/assets/flolah-mark.png" alt="">Flolah</a><nav aria-label="Site"><a href="/free-tools/">Open Agents Ecosystem</a><a href="/docs/">Docs</a></nav></header>
<main><div class="intro"><div class="eyebrow">Open Agents Ecosystem / Reusable procedures</div><h1>Skills Universe</h1><p>Give your AI employees a repeatable way to work. Explore reusable procedures, inspect their source and permissions, and choose the skills that fit your team.</p></div>
<aside class="notice"><p><strong>Discover here. Assign in Flolah.</strong> This directory reflects the source-controlled starter catalog, not a live workspace's publication state. Review and assign available skills in <strong>AI employee workspace → Skills</strong>. Assignment does not grant tools, connect accounts or approve actions. Admin-only draft imports are excluded.</p></aside>
<div class="controls"><div class="search"><label for="query">Search skills</label><input id="query" type="search" placeholder="Search names, descriptions or capabilities…"></div><div><label for="category">Category</label><select id="category"><option value="">All categories</option>OPTIONS</select></div></div>
<p id="summary" role="status" aria-live="polite">COUNT skills in the public starter directory</p>
<section class="grid" id="skills" aria-label="Skill directory">CARDS</section><p id="empty" hidden>No skills match. Try another search or category.</p>
<p>Developing a skill? <a href="https://github.com/balaji-ranga/agent-os/tree/main/skills-catalog">Read the catalog's source, curation and licensing guidance ↗</a></p>
</main><footer>Flolah · Open Agents Ecosystem · <a href="/legal/open-source.html">Open source notices</a></footer>
<script>
const query = document.getElementById('query');
const category = document.getElementById('category');
const cards = Array.from(document.querySelectorAll('#skills .card'));
function filterSkills() {
  const text = query.value.trim().toLocaleLowerCase();
  let visible = 0;
  cards.forEach(card => {
    const matches = (!category.value || card.dataset.category === category.value) && card.textContent.toLocaleLowerCase().includes(text);
    card.hidden = !matches;
    if (matches) visible++;
  });
  document.getElementById('summary').textContent = `${visible} of ${cards.length} skills`;
  document.getElementById('empty').hidden = visible !== 0;
}
query.addEventListener('input', filterSkills);
category.addEventListener('change', filterSkills);
</script></body></html>'''
page = page.replace('OPTIONS', options).replace('COUNT', str(len(skills))).replace('CARDS', '\n'.join(cards))
destination = root / 'deploy/static/flolah-home/free-tools/skills-universe/index.html'
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(page, encoding='utf-8')
print(f'Generated Skills Universe: {len(skills)} source-published entries')
