import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));const {build}=require('esbuild');const dir=fileURLToPath(new URL('./',import.meta.url));
await build({entryPoints:[dir+'js/main.js'],bundle:true,platform:'browser',format:'iife',outfile:dir+'app/src/main/assets/edge.js',alias:{'node:events':dir+'js/events.js','node:crypto':dir+'js/crypto.js','ws':dir+'js/ws.js'}});
