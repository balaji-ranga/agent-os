import { resolve } from 'node:path';
import { startLab } from './lab-runtime.js';
const dataDir=resolve(process.argv[2]||'.local/physical-lab');
const lab=await startLab({dataDir});
console.log('Physical lab cloud UI: '+lab.cloudUrl+'/api/physical/ui');
console.log('Physical simulator UI: '+lab.uiUrl);
console.log('Credentials saved to '+dataDir+'/access.json (never put them in a URL).');
console.log('Local-only test identity. This does not enable or modify the deployed Flolah platform.');
for(const sig of ['SIGINT','SIGTERM'])process.once(sig,async()=>{await lab.close();process.exit(0);});
