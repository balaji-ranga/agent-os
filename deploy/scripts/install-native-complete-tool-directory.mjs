// Spend the bounded directory budget on all authorized names before descriptions.
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
export function adaptCompleteToolDirectory(source){
 const before='\tif (fullDirectory.length <= 18e3) return fullDirectory;\n\tlet low = 0;';
 const lines=[
  '\tif (fullDirectory.length <= 18e3) return fullDirectory;',
  '\t// FLOLAH_COMPLETE_TOOL_DIRECTORY: retain names before descriptions.',
  '\tfor (const descriptionChars of [100, 60, 30, 0]) {',
  '\t\tconst compactLines = lines.map(line => {',
  '\t\t\tconst split = line.indexOf(": ");',
  '\t\t\treturn split < 0 ? line : line.slice(0, split) + (descriptionChars ? ": " + truncateUtf16Safe(line.slice(split + 2), descriptionChars) : "");',
  '\t\t});',
  '\t\tconst complete = renderToolSearchCatalogDirectory(compactLines, entries.length, mode);',
  '\t\tif (complete.length <= 18e3) return complete;',
  '\t}',
  '\tlet low = 0;'
 ];
 const after=lines.join('\n');
 if(source.includes(after))return source;
 if(source.split(before).length!==2)throw Error('Unsupported complete tool directory ABI');
 return source.replace(before,after);
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/install-native-complete-tool-directory.mjs')){
 const root=process.argv[2]||'/usr/local/lib/node_modules/openclaw/dist';let count=0;
 for(const file of readdirSync(root).filter(n=>/^local-model-lean-/.test(n)&&n.endsWith('.js'))){
  const path=join(root,file),source=readFileSync(path,'utf8');if(!source.includes('function formatToolSearchCatalogDirectory('))continue;
  writeFileSync(path,adaptCompleteToolDirectory(source));count++;
 }
 if(count!==1)throw Error('Expected one native tool directory runtime');
 console.log('NATIVE_COMPLETE_TOOL_DIRECTORY_OK');
}
