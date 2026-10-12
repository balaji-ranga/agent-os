import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const start='<!-- FLOLAH-PLATFORM-HELP-COPILOT:START -->';
const end='<!-- FLOLAH-PLATFORM-HELP-COPILOT:END -->';
/** Update ONLY platform-owned guidance; preserve custom identity and memory. */
export function syncPlatformHelpCopilot(template, destination) {
  const source=join(template,'UI-COPILOT.md');
  if(!existsSync(source))return false;
  mkdirSync(destination,{recursive:true});
  const guidance=readFileSync(source,'utf8');
  const writeChanged=(path,text)=>{if(!existsSync(path)||readFileSync(path,'utf8')!==text)writeFileSync(path,text,'utf8');};
  writeChanged(join(destination,'UI-COPILOT.md'),guidance);
  for(const name of ['AGENTS.md','TOOLS.md','SOUL.md']){
    const target=join(destination,name),fallback=join(template,name);
    const previous=existsSync(target)?readFileSync(target,'utf8'):existsSync(fallback)?readFileSync(fallback,'utf8'):'';
    const block=`${start}\n${guidance.trim()}\n${end}`;
    const a=previous.indexOf(start),b=previous.indexOf(end);
    // Malformed existing markers fail closed rather than discarding user text.
    if((a>=0)!==(b>=0)||(a>=0&&b<a))throw new Error(`Malformed Copilot guidance markers in ${name}`);
    const next=a>=0?previous.slice(0,a)+block+previous.slice(b+end.length):`${previous.trimEnd()}\n\n${block}\n`;
    writeChanged(target,next);
  }
  return true;
}
