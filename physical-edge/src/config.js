import {readFileSync,lstatSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

export function loadGatewayConfig(configPath){
 const file=resolve(configPath),config=JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
 const secret=(record,key)=>{
  const pathKey=key+'File';if(record?.[pathKey]===undefined)return;
  if(record[key])throw Error(`Use either ${key} or ${pathKey}, not both`);
  if(typeof record[pathKey]!=='string'||!record[pathKey].trim())throw Error(`Invalid ${pathKey}`);
  const path=resolve(dirname(file),record[pathKey]),stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192)throw Error(`Invalid credential file for ${pathKey}`);
  if(process.platform!=='win32'&&(stat.mode&0o077))throw Error(`Credential file for ${pathKey} must be private (chmod 600)`);
  const value=readFileSync(path,'utf8').replace(/^\uFEFF/,'').trim();
  if(!value||/[\r\n\0]/.test(value))throw Error(`Credential file for ${pathKey} must contain one nonempty token`);
  record[key]=value;
 };
 secret(config.hub,'token');secret(config,'localToken');
 for(const adapter of Object.values(config.adapters||{})){
  if(adapter.type==='home-assistant')secret(adapter,'token');
  if(adapter.type==='mqtt')secret(adapter,'password');
 }
 if(config.simulator?.mqtt)secret(config.simulator.mqtt,'password');
 return config;
}
