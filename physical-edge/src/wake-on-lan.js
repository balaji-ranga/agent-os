import {createSocket} from 'node:dgram';
import {isIPv4} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';

// Operator-configured destinations only; device actions cannot supply addresses.
export function validateWakeBinding(binding){
  const {mac,address,port=9,count=3,intervalMs=200}=binding||{};
  if(typeof mac!=='string'||!/^([a-f\d]{2}[:-]){5}[a-f\d]{2}$/i.test(mac))throw Error('Invalid wake MAC');
  if(!isIPv4(address||''))throw Error('Wake destination must be an IPv4 address');
  const [a,b]=address.split('.').map(Number);
  if(!(a===10||a===127||a===192&&b===168||a===172&&b>=16&&b<=31||a===169&&b===254||address==='255.255.255.255'))throw Error('Wake destination must be local');
  if(!Number.isInteger(port)||port<1||port>65535||!Number.isInteger(count)||count<1||count>5||!Number.isInteger(intervalMs)||intervalMs<0||intervalMs>1000)throw Error('Invalid wake packet limits');
  return {mac,address,port,count,intervalMs};
}

export async function sendWakePackets(binding){
  const {mac,address,port,count,intervalMs}=validateWakeBinding(binding);
  const bytes=Buffer.from(mac.replace(/[:-]/g,''),'hex');
  const packet=Buffer.concat([Buffer.alloc(6,255),...Array.from({length:16},()=>bytes)]);
  const socket=createSocket('udp4');
  let socketError;
  socket.on('error',error=>{socketError=error;});
  try{
    await new Promise((resolve,reject)=>{socket.once('error',reject);socket.bind(0,()=>{socket.removeListener('error',reject);resolve();});});
    socket.setBroadcast(true);
    for(let i=0;i<count;i++){
      if(socketError)throw socketError;
      await new Promise((resolve,reject)=>socket.send(packet,port,address,error=>error?reject(error):resolve()));
      if(i+1<count)await delay(intervalMs);
    }
  }finally{try{socket.close();}catch(error){if(error.code!=='ERR_SOCKET_DGRAM_NOT_RUNNING')throw error;}}
  // UDP delivery and actual power state are deliberately not asserted here.
}
