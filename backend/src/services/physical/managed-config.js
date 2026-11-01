import {id, fault, validateDescription, validateInput, fingerprint} from './contracts.js';

// Data-only binding contract shared by server and edge. No remote code or secrets.
export const MAPPING_VERSION=1;
const entityPattern=/^[a-z_]+\.[a-z0-9_]+$/;
export function validateMapping(mapping){
 if(!mapping||mapping.profile!=='ha-capability')throw fault('Managed mappings require ha-capability');
 id(mapping.id);validateDescription(mapping.description);
 if(mapping.description.id!==mapping.id)throw fault('Mapping identity mismatch');
 const allowed=['id','profile','description','actionBindings','observationBindings','simulated','evidenceCameraEntityId'];
 if(Object.keys(mapping).some(k=>!allowed.includes(k)))throw fault('Unsupported mapping field');
 if(mapping.evidenceCameraEntityId&&!/^camera\.[a-z0-9_]+$/.test(mapping.evidenceCameraEntityId))throw fault('Invalid camera entity');
 for(const [name,spec]of Object.entries(mapping.description.actions)){
  if(spec.expected.input){if(spec.input.properties?.[spec.expected.input]?.type!==mapping.description.properties[spec.expected.property]?.type)throw fault('Input and feedback types must match');}else validateInput(mapping.description.properties[spec.expected.property],spec.expected.value);
  const b=mapping.actionBindings?.[name];if(!b)throw fault('Every action needs a binding');
  const keys=Object.keys(spec.input.properties||{});
  if(b.transport==='home-assistant-app'){
   if(!/^media_player\.[a-z0-9_]+$/.test(b.entityId)||!b.sources||Array.isArray(b.sources))throw fault('Invalid app binding');
   const catalog=Object.keys(b.sources);if(!catalog.length||catalog.length>64||keys.length!==1||keys[0]!=='app'||spec.input.properties.app.type!=='string'||fingerprint([...catalog].sort())!==fingerprint([...(spec.input.properties.app.enum||[])].sort())||spec.input.required?.length!==1||spec.input.required[0]!=='app')throw fault('App schema must match approved catalog');
   for(const [key,value]of Object.entries(b.sources)){id(key);if(typeof value!=='string'||value.length>256||! /^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+$/.test(value))throw fault('Invalid application source');}
   if(Object.keys(b).some(k=>!['transport','entityId','sources'].includes(k)))throw fault('Unsupported app binding field');
  }else if(!b.transport||b.transport==='home-assistant'){
   if(keys.length||!['button','script'].includes(b.domain)||b.service!==(b.domain==='button'?'press':'turn_on')||!new RegExp('^'+b.domain+'\\.[a-z0-9_]+$').test(b.entityId)||Object.keys(b).some(k=>!['transport','domain','service','entityId'].includes(k)))throw fault('Invalid fixed HA binding');
  }else throw fault('Managed transport is not supported by this adapter');
 }
 if(Object.keys(mapping.actionBindings||{}).some(k=>!mapping.description.actions[k]))throw fault('Undeclared action binding');
 if(!Array.isArray(mapping.observationBindings)||mapping.observationBindings.length>32)throw fault('Observation bindings required');
 for(const b of mapping.observationBindings){
  if(Object.keys(b).some(k=>!['entityId','property','attribute','states'].includes(k))||!entityPattern.test(b.entityId)||!mapping.description.properties[b.property]||!b.states||Array.isArray(b.states))throw fault('Invalid observation binding');
  if(b.attribute===undefined?!/^(sensor|binary_sensor)\./.test(b.entityId):b.attribute!=='app_id'||!/^media_player\./.test(b.entityId))throw fault('Unsupported observation source');
  for(const value of Object.values(b.states))validateInput(mapping.description.properties[b.property],value);
 }
 for(const spec of Object.values(mapping.description.actions))if(!mapping.observationBindings.some(b=>b.property===spec.expected.property))throw fault('Action requires independent feedback');
 if(JSON.stringify(mapping).length>32768)throw fault('Mapping too large');
 return mapping;
}
export function validateManagedDocument(document){
 if(Object.keys(document||{}).some(k=>!['version','mappings'].includes(k)))throw fault('Unsupported configuration field');
 if(document?.version!==MAPPING_VERSION||!Array.isArray(document.mappings)||document.mappings.length>100)throw fault('Unsupported managed configuration');
 const seen=new Set();for(const m of document.mappings){if(Object.keys(m).some(k=>!['adapterId','mapping'].includes(k)))throw fault('Unsupported adapter binding field');id(m.adapterId);validateMapping(m.mapping);if(seen.has(m.mapping.id))throw fault('Duplicate device identity');seen.add(m.mapping.id);}
 return document;
}
