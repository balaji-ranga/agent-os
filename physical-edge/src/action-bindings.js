import {validateWakeBinding,sendWakePackets} from './wake-on-lan.js';

// Curated protocol implementations. Configuration selects a binding, never code.
const transports={
  'home-assistant':{
    validate(binding){
      const {domain,service,entityId}=binding;
      if(!['button','script'].includes(domain)||service!==(domain==='button'?'press':'turn_on')||!new RegExp('^'+domain+'\\.[a-z0-9_]+$').test(entityId))throw Error('Invalid HA action binding');
    },
    async invoke(binding,context){
      await context.callHomeAssistant({domain:binding.domain,service:binding.service,target:{entity_id:binding.entityId}});
    }
  },
  'wake-on-lan':{validate:validateWakeBinding,invoke:sendWakePackets},
  'home-assistant-app':{
    inputs:['app'],
    validate(binding){
      if(!/^media_player\.[a-z0-9_]+$/.test(binding.entityId)||!binding.sources||typeof binding.sources!=='object'||Array.isArray(binding.sources))throw Error('Invalid HA app binding');
      const entries=Object.entries(binding.sources);
      if(!entries.length||entries.length>64||entries.some(([key,value])=>!/^\w[\w-]{0,95}$/.test(key)||typeof value!=='string'||! /^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+$/.test(value)||value.length>256))throw Error('Invalid approved app catalog');
    },
    async invoke(binding,context){
      const app=context.input?.app;
      if(typeof app!=='string'||!Object.hasOwn(binding.sources,app))throw Error('App is not in the approved catalog');
      await context.callHomeAssistant({domain:'media_player',service:'select_source',target:{entity_id:binding.entityId},service_data:{source:binding.sources[app]}});
    }
  }
};

function transport(binding){
  const name=binding?.transport||'home-assistant';
  if(!Object.hasOwn(transports,name))throw Error('Unapproved action transport');
  return transports[name];
}
export function validateActionBinding(binding,inputSchema){
  const implementation=transport(binding);implementation.validate(binding);
  if(inputSchema){
    const keys=Object.keys(inputSchema.properties||{}),allowed=implementation.inputs||[];
    if(keys.length!==allowed.length||keys.some(key=>!allowed.includes(key)))throw Error('Binding input schema does not match transport');
    if(binding.transport==='home-assistant-app'){
      const app=inputSchema.properties.app,catalog=Object.keys(binding.sources);
      if(app.type!=='string'||!Array.isArray(app.enum)||app.enum.length!==catalog.length||catalog.some(key=>!app.enum.includes(key))||inputSchema.required?.length!==1||inputSchema.required[0]!=='app')throw Error('App input must enumerate exactly the approved catalog');
    }
  }
}
export async function invokeActionBinding(binding,context){
  const implementation=transport(binding);
  implementation.validate(binding);
  await implementation.invoke(binding,context);
}
