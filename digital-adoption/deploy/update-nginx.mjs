import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
const file='/nginx/nginx.host-network.conf';
const current=readFileSync(file,'utf8');
if(current.includes('location ^~ /free-tools/digital-adoption/')){
 const blocks=current.match(/location \^~ \/free-tools\/digital-adoption\/\s*\{[^}]+\}/g);
 if(blocks?.length!==1)throw new Error('Expected one independent service location');
 const block=blocks[0];if(!/client_max_body_size (32k|23m);/.test(block))throw new Error('Unexpected adoption upload limit; manual comparison required');
 const updated=block.replace('client_max_body_size 32k;','client_max_body_size 23m;');
 if(updated!==block){copyFileSync(file,file+'.before-adoption-uploads');writeFileSync(file,current.replace(block,updated));}
 console.log('Independent service location verified; upload limit scoped to this service only');process.exit(0);
}
const marker='server {\n    listen 443 ssl http2;\n    listen [::]:443 ssl http2;\n    server_name login.flolah.cloud;';
if(current.split(marker).length!==2)throw new Error('Expected unique login HTTPS server; refusing automatic edit');
const addition=readFileSync('/release/deploy/nginx-host-locations.conf','utf8');
copyFileSync(file,file+'.before-digital-adoption');
writeFileSync(file,current.replace(marker,marker+'\n\n'+addition));
console.log('Added only independent adoption locations; backup retained');
