import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
const out=new URL('../../.local/frameworks/',import.meta.url);await mkdir(out,{recursive:true});
for(const name of ['react','angular'])await build({entryPoints:[new URL(`${name}.mjs`,import.meta.url).pathname.replace(/^\/C:/,'C:')],outfile:new URL(`${name}.bundle.mjs`,out).pathname.replace(/^\/C:/,'C:'),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:false,define:{'process.env.NODE_ENV':'"development"'}});
