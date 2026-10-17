import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
const file='/nginx/nginx.host-network.conf';
const current=readFileSync(file,'utf8');
if(current.includes('location ^~ /free-tools/digital-adoption/')){console.log('Independent locations already present');process.exit(0);}
const marker='server {\n    listen 443 ssl http2;\n    listen [::]:443 ssl http2;\n    server_name login.flolah.cloud;';
if(current.split(marker).length!==2)throw new Error('Expected unique login HTTPS server; refusing automatic edit');
const addition=readFileSync('/release/deploy/nginx-host-locations.conf','utf8');
copyFileSync(file,file+'.before-digital-adoption');
writeFileSync(file,current.replace(marker,marker+'\n\n'+addition));
console.log('Added only independent adoption locations; backup retained');
