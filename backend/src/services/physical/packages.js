import { readFileSync,existsSync } from 'node:fs';
import { resolve,dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
const defaultDir=fileURLToPath(new URL('../../../../physical-edge/dist/',import.meta.url));
export function packageDirectory(){return resolve(process.env.FLOLAH_PHYSICAL_PACKAGE_DIR||defaultDir);}
export function packageCatalog(){
 try {const m=JSON.parse(readFileSync(join(packageDirectory(),'manifest.json'),'utf8'));return {...m,packages:m.packages.filter(p=>/^[a-zA-Z0-9_.-]+\.(zip|apk)$/.test(p.file)&&existsSync(join(packageDirectory(),p.file)))};}
 catch{return {version:null,packages:[]};}
}
