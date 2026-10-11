import { readFile, writeFile } from 'node:fs/promises';
import { extractTextFromBuffer } from './master-data-extract.js';

const [input,output]=process.argv.slice(2);
if(!input||!output)throw new Error('Input and output paths required');
const text=await extractTextFromBuffer(await readFile(input),undefined,input);
if(/^\[(Failed to extract|Binary file:|Word \.doc file:)/.test(text))throw new Error('Office extraction failed; source remains unpublished for retry');
await writeFile(output,text,{encoding:'utf8',mode:0o600});
