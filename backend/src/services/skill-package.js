import { createHash } from 'node:crypto';

export const skillDigest = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw Object.assign(new Error(message), {status:400}); };
const list = value => [...new Set((Array.isArray(value) ? value : String(value || '').split(/[\n,]/)).map(x => String(x).trim()).filter(Boolean))];

export function normalizeSkillPackage(body = {}) {
  const skill_md = String(body.skill_md || '').trim() + '\n';
  if (Buffer.byteLength(skill_md) > 128 * 1024 || skill_md.includes('\0')) fail('SKILL.md must be UTF-8 text under 128 KB');
  const block = skill_md.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  const pick = key => block?.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '') || '';
  const slug = String(body.slug || pick('name')).trim();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) fail('Skill name must be a lowercase slug under 65 characters');
  if (!block || !pick('name') || !pick('description')) fail('SKILL.md requires name and description frontmatter');
  const resources = body.resources || {};
  if (Array.isArray(resources) || typeof resources !== 'object' || Object.keys(resources).length > 64) fail('At most 64 text resource files are supported');
  let bytes = Buffer.byteLength(skill_md);
  for (const [path, content] of Object.entries(resources)) {
    if (!/^(?:references|assets|examples)\/[a-zA-Z0-9_./-]+\.(?:md|txt|json|csv|yaml|yml)$/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..') || path.includes('\\')) fail('Resource paths must be safe references/assets/examples text files');
    if (typeof content !== 'string' || content.includes('\0')) fail('Only text resources are supported; executable/binary packages are not installed');
    bytes += Buffer.byteLength(content);
  }
  if (bytes > 1024 * 1024) fail('Skill package exceeds 1 MB');
  const required_tools = list(body.required_tools);
  const required_connector_actions = list(body.required_connector_actions);
  const required_mcp_tools = list(body.required_mcp_tools);
  if (required_tools.some(x => !/^[a-z0-9][a-z0-9_-]*$/.test(x)) || required_connector_actions.some(x => !/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(x)) || required_mcp_tools.some(x => !/^[^\s:]+::[^\s:]+$/.test(x))) fail('Use canonical tool, connector action and server::tool identifiers');
  if ([required_tools,required_connector_actions,required_mcp_tools].some(x => x.length > 64)) fail('Too many capability requirements');
  const provenance = body.provenance || {};
  if (Array.isArray(provenance) || typeof provenance !== 'object') fail('Provenance must be an object');
  if (Buffer.byteLength(String(provenance.license_text || '')) > 128 * 1024) fail('License text exceeds 128 KB');
  const license = String(provenance.license || '').trim().slice(0,80);
  const source_url = String(provenance.source_url || '').trim();
  if (source_url && !/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:\/[^\s?#]*)?$/.test(source_url)) fail('Source must be a public GitHub URL without query/fragment');
  const external_requirements = list(body.external_requirements).slice(0,32);
  const warnings = [];
  if (!license) warnings.push('License missing: publication is blocked until permission is documented.');
  if (/\b(curl|wget|sudo|pip install|npm install|npx|bash|python3?\s+scripts\/|node\s+scripts\/)\b/i.test(skill_md)) warnings.push('Upstream instructions mention installation or native code. Review/adapt; no commands are installed or run by onboarding.');
  if (/ignore (?:all|previous)|disable.*(?:approval|security)|(?:api[_ -]?key|password|token)\s*[:=]\s*[a-zA-Z0-9_-]{16,}/i.test(skill_md)) warnings.push('Potential unsafe instruction or embedded secret: manual review required.');
  const identity = {slug,name:String(body.name || pick('name')).slice(0,160),description:String(body.description || pick('description')).slice(0,1000),category:String(body.category || 'Operations').slice(0,80),trigger_hints:list(body.trigger_hints).slice(0,32),skill_md,resources,required_tools,required_connector_actions,required_mcp_tools,external_requirements,provenance:{kind:String(provenance.kind || '').slice(0,80),commit:String(provenance.commit || '').slice(0,40),imported_at:String(provenance.imported_at || '').slice(0,40),license_text:String(provenance.license_text || ''),license,source_url}};
  return {...identity,checksum:skillDigest(skill_md),package_checksum:skillDigest(JSON.stringify(identity)),warnings};
}

export function parseGithubSkillUrl(url) {
  const match = String(url || '').match(/^https:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/blob\/([a-f0-9]{40})\/(.+\/)?SKILL\.md$/);
  if (!match || match.slice(1).some(x => x?.split('/').some(p => p === '..' || p === '.')) || /[?#%\\]/.test(url)) fail('Use a public github.com/.../blob/<40-character commit>/.../SKILL.md URL. Branch URLs are not immutable.');
  return {owner:match[1],repo:match[2],commit:match[3],path:(match[4] || '') + 'SKILL.md'};
}

export async function previewGithubSkill(url, {fetchImpl = fetch} = {}) {
  const source = parseGithubSkillUrl(url);
  const read = async path => {
    const response = await fetchImpl(`https://raw.githubusercontent.com/${source.owner}/${source.repo}/${source.commit}/${path}`, {redirect:'error',signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw Object.assign(new Error(`GitHub file unavailable (${response.status})`),{status:400});
    if (Number(response.headers.get('content-length') || 0) > 128*1024) fail('GitHub file exceeds 128 KB');
    let size = 0; const chunks = [];
    for await (const chunk of response.body) {size += chunk.length; if (size > 128*1024) fail('GitHub file exceeds 128 KB'); chunks.push(chunk);}
    return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
  };
  const skill_md = await read(source.path);
  let license_text = '';
  // Exact source and repository license only; never follow URLs from instructions.
  const folder = source.path.slice(0,-'SKILL.md'.length);
  for (const path of [`${folder}LICENSE.txt`,`${folder}LICENSE`,'LICENSE','LICENSE.txt']) {
    try {license_text = await read(path); break;} catch (e) {if (!e.message.includes('unavailable (404)')) throw e;}
  }
  const license = /MIT License|Permission is hereby granted, free of charge/.test(license_text) ? 'MIT' : /Apache License[\s\S]*Version 2\.0/.test(license_text) ? 'Apache-2.0' : '';
  return normalizeSkillPackage({skill_md,provenance:{source_url:url,commit:source.commit,license,license_text,imported_at:new Date().toISOString()},external_requirements:['Review upstream dependencies and relative references; import downloads SKILL.md and license only.']});
}
