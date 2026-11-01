// Local lab and acceptance broker. Deployment uses Mosquitto; never expose this lab server.
import aedes from 'aedes';
import { createServer } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
export async function startTestBroker(accounts,{port=0,host='127.0.0.1'}={}){
  const broker=aedes();
  broker.authenticate=(client,username,password,done)=>{
    const account=accounts[String(username)];const provided=Buffer.from(password||''),expected=Buffer.from(account?.password||'');
    if(!account||provided.length!==expected.length||!timingSafeEqual(provided,expected))return done(null,false);
    client.physicalAccount=account;done(null,true);
  };
  const allowed=(account,topic,write)=>{
    if(!account)return false;
    if(account.role==='home-assistant'&&topic==='homeassistant/status')return true;
    // HA versions use different wildcard discovery filters. Delivery remains scoped
    // by authorizeForward below to this hub's concrete discovery topics.
    if(account.role==='home-assistant'&&!write&&topic.startsWith('homeassistant/')&&(topic.includes('#')||topic.includes('+')))return true;
    if(topic.startsWith(account.root+'/')){
      if(!write)return true;
      return account.role==='simulator'?/\/(event|state)$/.test(topic):account.role==='home-assistant'?topic.endsWith('/ha/set'):/\/(command|cancel|read)$/.test(topic);
    }
    return topic.startsWith('homeassistant/')&&topic.includes('/'+account.discoveryPrefix)&&(!write||account.role==='simulator');
  };
  broker.authorizePublish=(client,packet,done)=>done(allowed(client.physicalAccount,packet.topic,true)?null:Error('Topic access denied'));
  broker.authorizeSubscribe=(client,sub,done)=>done(null,allowed(client.physicalAccount,sub.topic,false)?sub:null);
  broker.authorizeForward=(client,packet)=>allowed(client.physicalAccount,packet.topic,false)?packet:null;
  const server=createServer(broker.handle);await new Promise(r=>server.listen(port,host,r));
  return {broker,server,url:'mqtt://'+host+':'+server.address().port,async close(){for(const c of Object.values(broker.clients))c.close();await new Promise(r=>broker.close(r));await new Promise(r=>server.close(r));}};
}
