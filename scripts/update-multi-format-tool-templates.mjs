// Mechanical template synchronization; no runtime/company workspaces are modified.
import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {MULTI_FORMAT_TOOL_GUIDANCE} from '../backend/src/lib/multi-format-tool-guide.js';
const root=fileURLToPath(new URL('../openclaw-workspace-templates/',import.meta.url));
let count=0;
for(const directory of readdirSync(root,{withFileTypes:true})) {
  if(!directory.isDirectory())continue;
  const path=join(root,directory.name,'TOOLS.md');
  let text;try{text=readFileSync(path,'utf8').replace(/\r\n/g,'\n');}catch{continue;}
  const marker='\n## Multi format content generation conversion and OCR';
  if(text.includes(marker))text=text.slice(0,text.indexOf(marker)).trimEnd();
  writeFileSync(path,text.trimEnd()+'\n\n'+MULTI_FORMAT_TOOL_GUIDANCE,'utf8');count++;
}
console.log(`MULTI_FORMAT_TEMPLATES_UPDATED ${count}`);
