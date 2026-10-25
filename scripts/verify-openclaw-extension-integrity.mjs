import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import {verifyExtensionIntegrity} from './lib/openclaw-extension-integrity.js';
import {resolveOpenClawExtensionsDir} from './lib/openclaw-paths.js';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const result=verifyExtensionIntegrity(join(root,'openclaw-extensions'),process.argv.includes('--source-only')?null:resolveOpenClawExtensionsDir());
console.log(JSON.stringify({check:'openclaw-extension-integrity',...result}));
