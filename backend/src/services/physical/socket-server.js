import { WebSocketServer } from 'ws';

export function attachPhysicalHubServer(server,plane,{path='/api/physical/hub',authorizeConnection=()=>{},subscribePolicyChanges,heartbeatMs=15000}={}) {
  const wss=new WebSocketServer({noServer:true,maxPayload:512*1024,perMessageDeflate:false});
  const upgrade=(req,socket,head)=>{
    if(req.url!==path)return;
    try{
      if(req.headers.origin)throw Error('Machine channel only');
      const hub=plane.authenticate(String(req.headers['x-flolah-hub']||''),String(req.headers.authorization||'').replace(/^Bearer /,''));
      authorizeConnection(hub,req);
      wss.handleUpgrade(req,socket,head,ws=>{
        ws.hubId=hub.id;ws.ipRequest=req;let ready=false,count=0,windowStart=Date.now();
        ws.lastPongAt=Date.now();ws.on('pong',()=>{ws.lastPongAt=Date.now();});
        plane.connect(hub.id,ws);
        ws.on('error',()=>{});
        ws.on('message',raw=>{
          try{
            plane.authenticate(hub.id,String(req.headers.authorization||'').replace(/^Bearer /,''));
            authorizeConnection(hub,req);
            if(Date.now()-windowStart>1000){count=0;windowStart=Date.now();}if(++count>200)throw Error('Rate limit');
            const m=JSON.parse(raw);
            if(m.type==='discover')plane.discover(hub.id,m.descriptions);
            else if(m.type==='configuration_ack')plane.managedAck(hub.id,m);
            else if(m.type==='hub_report')plane.hubReport(hub.id,m);
            else if(m.type==='ready'){ready=true;plane.dispatchQueued(hub.id);}
            else if(m.type==='event'){
              try{plane.event(hub.id,m.event);ws.send(JSON.stringify({type:'event_ack',eventId:m.event.eventId}));}
              catch{plane.audit(hub.owner,'hub_event_rejected',{hubId:hub.id,eventId:String(m.event?.eventId||'').slice(0,96)});ws.send(JSON.stringify({type:'event_ack',eventId:m.event?.eventId,rejected:true}));}
            }else throw Error('Unknown message');
          }catch{ws.close(4002,'Invalid or unauthorized hub message');}
        });
        ws.on('close',()=>plane.disconnect(hub.id,ws));
        ws.isReady=()=>ready;
      });
    }catch(e){socket.write('HTTP/1.1 '+(e.status===403?'403 Forbidden':'401 Unauthorized')+ '\r\nConnection: close\r\n\r\n');socket.destroy();}
  };
  server.on('upgrade',upgrade);
  const checkConnections=owner=>{for(const ws of wss.clients){if(owner&&plane.state.hubs[ws.hubId]?.owner!==owner)continue;try{const h=plane.state.hubs[ws.hubId];if(!h||h.revoked)throw Error();authorizeConnection(h,ws.ipRequest);}catch{plane.disconnect(ws.hubId,ws);ws.close(4003,'Hub access policy changed');}}};
  const unsubscribe=subscribePolicyChanges?.(checkConnections);
  const timer=setInterval(()=>{
    checkConnections();plane.expire();
    for(const ws of wss.clients){
      const h=plane.state.hubs[ws.hubId];
      if(Date.now()-ws.lastPongAt>heartbeatMs*3){plane.disconnect(ws.hubId,ws);ws.terminate();continue;}
      if(!h||h.revoked)ws.close(4003,'Hub revoked');
      else {ws.ping();plane.sendConfig(h.id);}
    }
  },heartbeatMs);timer.unref();
  return {async close(){unsubscribe?.();clearInterval(timer);server.off('upgrade',upgrade);for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));}};
}
