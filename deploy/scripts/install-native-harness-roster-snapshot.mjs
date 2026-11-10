// Scope roster reuse to one synchronous, read-only harness discovery traversal.
// No cross-call cache: edits, tenants and runtime policies are re-read next call.
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.argv[2]||'/usr/local/lib/node_modules/openclaw/dist';
const locate=pattern=>{const matches=readdirSync(root).filter(n=>pattern.test(n));if(matches.length!==1)throw Error('Unsupported native roster ABI');return matches[0];};
const harnessName=locate(/^harness-runtimes-.*\.js$/);
const rosterImports=[...readFileSync(join(root,harnessName),'utf8').matchAll(/from ["']\.\/(agent-scope-config-[^"']+\.js)["']/g)];
const rosterNames=[...new Set(rosterImports.map(m=>m[1]))];
if(rosterNames.length!==1)throw Error('Unsupported native roster import ABI');
const rosterName=rosterNames[0];
const rosterPath=join(root,rosterName),harnessPath=join(root,harnessName);
let roster=readFileSync(rosterPath,'utf8'),harness=readFileSync(harnessPath,'utf8');
const marker='const flolahScopedRosterSnapshots = new WeakMap();';
const anchor='function listAgentEntriesWithSource(cfg) {\n';
const start='function collectConfiguredAgentHarnessRuntimes(config, options = {}) {\n';
const finish='\treturn [...runtimes].toSorted((left, right) => left.localeCompare(right));\n}';
if(roster.includes(marker)&&harness.includes('return flolahWithRosterSnapshot(config, () => {')){console.log('HARNESS_ROSTER_SNAPSHOT_ALREADY_INSTALLED');process.exit(0);}
if(roster.includes(marker)||harness.includes('flolahWithRosterSnapshot')||roster.split(anchor).length!==2||harness.split(start).length!==2||harness.split(finish).length!==2)throw Error('Unsupported native harness discovery ABI; no files changed');
const helper=`${marker}
export function flolahWithRosterSnapshot(cfg, callback) {
 if (!cfg || typeof cfg !== 'object' || flolahScopedRosterSnapshots.has(cfg)) return callback();
 const snapshot = listAgentEntriesWithSource(cfg);
 flolahScopedRosterSnapshots.set(cfg, snapshot);
 try { return callback(); } finally { flolahScopedRosterSnapshots.delete(cfg); }
}
`;
const nextRoster=roster.replace(anchor,helper+anchor+'\tif (flolahScopedRosterSnapshots.has(cfg)) return flolahScopedRosterSnapshots.get(cfg);\n');
const nextHarness=`import {flolahWithRosterSnapshot} from './${rosterName}';\n`+harness.replace(start,start+'\treturn flolahWithRosterSnapshot(config, () => {\n').replace(finish,'\treturn [...runtimes].toSorted((left, right) => left.localeCompare(right));\n\t});\n}');
// Reference module is only used by regression tests; its traversal remains uncached.
writeFileSync(join(root,'flolah-harness-reference.mjs'),harness);
writeFileSync(rosterPath,nextRoster);writeFileSync(harnessPath,nextHarness);
console.log('HARNESS_ROSTER_SNAPSHOT_INSTALLED');
