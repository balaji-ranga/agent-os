import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const file='/static/free-tools/index.html';
const old='https://login.flolah.cloud/free-tools/digital-adoption/manage.html';
const replacement='https://login.flolah.cloud/free-tools/digital-adoption/owner.html';
const text=readFileSync(file,'utf8');
if(text.includes(old)){
 if(text.split(old).length!==2)throw new Error('Unexpected entrypoint count; preserve live page');
 const backup=file+'.before-owner-onboarding';if(!existsSync(backup))writeFileSync(backup,text);
 writeFileSync(file,text.replace(old,replacement));
}else if(!text.includes(replacement))throw new Error('Free tool entrypoint not found; preserve live page');
