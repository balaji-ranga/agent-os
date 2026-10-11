// Operational recovery control. Does not disable memory tools, delete memories,
// modify tenant agents, or rebuild the gateway configuration.
import { readFileSync, writeFileSync, renameSync, copyFileSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export function setMemorySchedule(config, enabled) {
  if(typeof enabled!=='boolean')throw new Error('Explicit boolean required');
  const next=structuredClone(config);
  next.plugins??={};next.plugins.entries??={};
  const entry=next.plugins.entries['memory-core']??={};
  entry.config??={};entry.config.dreaming??={};
  entry.config.dreaming.enabled=enabled;
  return next;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [file,mode]=process.argv.slice(2);
  if(!file||!['pause','resume'].includes(mode))throw new Error('Usage: node set-openclaw-memory-schedule.mjs /absolute/openclaw.json pause|resume');
  const path=resolve(file),original=readFileSync(path,'utf8');
  const updated=setMemorySchedule(JSON.parse(original),mode==='resume');
  const backup=`${path}.memory-schedule-${Date.now()}.bak`;
  copyFileSync(path,backup,constants.COPYFILE_EXCL);
  const temp=`${path}.memory-schedule-${process.pid}.tmp`;
  writeFileSync(temp,JSON.stringify(updated,null,2)+'\n',{mode:0o600,flag:'wx'});
  renameSync(temp,path);
  console.log(`Managed memory consolidation ${mode==='pause'?'paused':'resumed'}; original configuration backed up. Memory tools and workspaces unchanged.`);
}
