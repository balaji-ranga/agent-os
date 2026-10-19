// Deployment-only: preserve private settings and emit no credentials.
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {createUploadAdmission,uploadDefaults} from '../src/upload-admission.mjs';
const path='/config/service.json',prior=JSON.parse(readFileSync(path,'utf8')),peers=JSON.parse(process.argv[2]||'[]');
if(!Array.isArray(peers)||peers.some(ip=>typeof ip!=='string'||!/^[:.a-fA-F0-9]+$/.test(ip)))throw new Error('Invalid proxy peers');
const uploads={...uploadDefaults,...prior.uploads};createUploadAdmission({limits:uploads});
const next={...prior,uploads,uploadProxyAddresses:prior.uploadProxyAddresses||peers};
writeFileSync(path+'.uploads-next',JSON.stringify(next),{mode:0o600});renameSync(path+'.uploads-next',path);
console.log('Validated upload budgets persisted; unrelated private settings preserved.');
