// Shared wire contracts. No runtime, DB, vendor SDK or agent-name dependencies.
import { createHash } from 'node:crypto';

export const VERSION = 1;
export const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'timed_out', 'uncertain', 'denied']);
export const id = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value)) throw fault('Invalid identifier');
  return value;
};
export function fault(message, status = 400) { return Object.assign(new Error(message), { status }); }
export function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw fault('Expected object'); return value; }
export function hash(value) { return createHash('sha256').update(value).digest('hex'); }
export function fingerprint(value) {
  const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return hash(JSON.stringify(canonical(value)));
}
export function validateInput(schema, value) {
  if (schema.type === 'object') {
    object(value);
    if (Object.keys(value).some(k => !Object.hasOwn(schema.properties || {}, k))) throw fault('Unsupported input field');
    for (const k of schema.required || []) if (!Object.hasOwn(value, k)) throw fault('Missing input: ' + k);
    for (const [k, v] of Object.entries(value)) validateInput(schema.properties[k], v);
  } else {
    if (!['boolean', 'string', 'number', 'integer'].includes(schema.type)) throw fault('Unsupported schema type');
    if (schema.type === 'integer' ? !Number.isSafeInteger(value) : typeof value !== schema.type) throw fault('Input type mismatch');
    if (typeof value === 'number' && (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) throw fault('Input outside bounds');
    if (typeof value === 'string' && (value.length > (schema.maxLength ?? 256) || value.length < (schema.minLength ?? 0))) throw fault('Input length outside bounds');
    if (schema.enum && !schema.enum.includes(value)) throw fault('Unsupported input value');
  }
  return value;
}
// Output contracts are bounded data, never executable adapter instructions.
export const PHYSICAL_RESERVED_OUTPUTS=new Set(['ok','status','operation_id','entity_id','site_id','hub_id','simulated','result','evidence','property','value','observed_at','text','output_contract','__proto__','prototype','constructor']);
export function validateOutputSchema(schema,depth=0){
  object(schema);if(depth>5)throw fault('Output schema nesting limit');
  if(!['object','array','string','number','integer','boolean'].includes(schema.type))throw fault('Unsupported output type');
  if(schema.type==='object'){
    object(schema.properties||{});if(Object.keys(schema.properties||{}).length>32)throw fault('Too many output fields');
    for(const [k,v]of Object.entries(schema.properties||{})){id(k);if(['__proto__','constructor','prototype'].includes(k))throw fault('Invalid output field');validateOutputSchema(v,depth+1);}
    if(!Array.isArray(schema.required||[])||(schema.required||[]).some(k=>!Object.hasOwn(schema.properties||{},k)))throw fault('Invalid required outputs');
  }else if(schema.type==='array'){validateOutputSchema(schema.items,depth+1);if(!Number.isInteger(schema.maxItems)||schema.maxItems<1||schema.maxItems>64)throw fault('Output arrays require maxItems 1–64');}
  if(schema.mediaType&&!['image','video','stream','audio'].includes(schema.mediaType))throw fault('Unsupported output media type');
  if(schema.mediaType&&schema.type!=='object')throw fault('Media output must be a protected reference object');
  if(JSON.stringify(schema).length>16384)throw fault('Output schema too large');return schema;
}
export function validateOutputValue(schema,value){
  if(schema.type==='array'){if(!Array.isArray(value)||value.length>schema.maxItems)throw fault('Invalid output array');for(const v of value)validateOutputValue(schema.items,v);}
  else if(schema.type==='object'){object(value);if(Object.keys(value).some(k=>!Object.hasOwn(schema.properties||{},k)))throw fault('Undeclared output field');for(const k of schema.required||[])if(!Object.hasOwn(value,k))throw fault('Missing output: '+k);for(const [k,v]of Object.entries(value))validateOutputValue(schema.properties[k],v);}
  else validateInput(schema,value);return value;
}
export function validateActionOutput(output){
  object(output);if(!Number.isSafeInteger(output.version)||output.version<1||output.version>100000)throw fault('Invalid output contract version');
  validateOutputSchema(output.schema);if(output.schema.type!=='object')throw fault('Operation output must be an object');object(output.bindings);
  if(Object.keys(output.bindings).some(k=>!Object.hasOwn(output.schema.properties,k)))throw fault('Undeclared output binding');
  for(const key of Object.keys(output.schema.properties)){
    if(PHYSICAL_RESERVED_OUTPUTS.has(key))throw fault('Output conflicts with operation metadata');const b=object(output.bindings[key]);
    if(!['observation_value','observation_time','evidence_image','device_result'].includes(b.source)||Object.keys(b).some(k=>!['source','index','path'].includes(k)))throw fault('Unsupported output binding');
    if(b.source==='evidence_image'&&(b.index!==0||output.schema.properties[key].mediaType!=='image'))throw fault('Invalid evidence output binding');
    if(b.source==='device_result'&&(!Array.isArray(b.path)||!b.path.length||b.path.length>5||b.path.some(k=>typeof k!=='string'||! /^[a-zA-Z0-9_-]{1,96}$/.test(k)||['__proto__','constructor','prototype'].includes(k))))throw fault('Invalid result binding path');
  }return output;
}
export function imageReferenceSchema(){return {type:'object',mediaType:'image',properties:{kind:{type:'string',enum:['image']},ref:{type:'string',maxLength:160},mime_type:{type:'string',enum:['image/png','image/jpeg']},sha256:{type:'string',minLength:64,maxLength:64},captured_at:{type:'number'},simulated:{type:'boolean'}},required:['kind','ref','mime_type','sha256','captured_at','simulated']};}
export function validateDescription(td) {
  object(td); id(td.id);
  if (td['@context'] !== 'https://www.w3.org/2022/wot/td/v1.1' || typeof td.title !== 'string' || td.title.length > 200) throw fault('Invalid WoT profile');
  if (!['PhysicalDevice','PhysicalAgent'].includes(td.flolah?.kind) || typeof td.flolah?.simulated !== 'boolean') throw fault('Missing physical identity metadata');
  object(td.properties); object(td.actions);
  if (Object.keys(td.actions).length > 32 || Object.keys(td.properties).length > 32) throw fault('Too many capabilities');
  for (const [name, spec] of Object.entries(td.actions)) {
    id(name);
    if(spec.output)validateActionOutput(spec.output);
    if (!['routine','approval_required','prohibited'].includes(spec.risk) || spec.input?.type !== 'object' || typeof spec.task !== 'boolean') throw fault('Invalid action specification');
    if (spec.task && td.flolah.kind !== 'PhysicalAgent') throw fault('Device cannot own tasks');
    if (!spec.expected || typeof spec.expected.property !== 'string' || !Object.hasOwn(td.properties, spec.expected.property)) throw fault('Action requires observable evidence contract');
    if (spec.expected.input ? !Object.hasOwn(spec.input.properties || {}, spec.expected.input) : !Object.hasOwn(spec.expected,'value')) throw fault('Evidence must name an input or literal expected value');
    if (spec.task && (!td.flolah.taskLifecycle?.progress || !td.flolah.taskLifecycle?.outcomes)) throw fault('PhysicalAgent requires task lifecycle evidence');
  }
  for (const [name, spec] of Object.entries(td.properties)) { id(name); if (!['string','number','boolean','integer'].includes(spec.type)) throw fault('Invalid property type'); }
  return td;
}
export function profile(entityId, kind = 'switch') {
  id(entityId);
  const td = { '@context':'https://www.w3.org/2022/wot/td/v1.1', id:entityId, title:entityId,
    securityDefinitions:{flolah_sc:{scheme:'bearer',in:'header'}}, security:['flolah_sc'],
    flolah:{kind:kind==='robot'?'PhysicalAgent':'PhysicalDevice',simulated:true,profile:kind,version:VERSION}, properties:{},actions:{},events:{} };
  // Metadata describes the governed Flolah API; device transports have separate credentials.
  if (kind === 'switch') {
    td.properties={on:{type:'boolean'}};
    td.actions={set_state:{risk:'routine',task:false,input:{type:'object',properties:{on:{type:'boolean'}},required:['on']},expected:{property:'on',input:'on'}}};
  } else if (kind === 'tv') {
    td.properties={on:{type:'boolean'},app:{type:'string'},channel:{type:'integer'},last_navigation:{type:'string'}};
    const action=(properties,required,expected)=>({risk:'routine',task:false,input:{type:'object',properties,required},expected});
    td.actions={
      set_power:action({on:{type:'boolean'}},['on'],{property:'on',input:'on'}),
      launch_app:action({app:{type:'string',minLength:1,maxLength:96}},['app'],{property:'app',input:'app'}),
      select_channel:action({channel:{type:'integer',minimum:1,maximum:9999}},['channel'],{property:'channel',input:'channel'}),
      navigate:action({command:{type:'string',enum:['DPAD_UP','DPAD_DOWN','DPAD_LEFT','DPAD_RIGHT','DPAD_CENTER','BACK','HOME']}},['command'],{property:'last_navigation',input:'command'})
    };
  } else if(kind==='camera'){
    td.properties={captured:{type:'boolean'}};
    td.actions={capture:{risk:'routine',task:false,input:{type:'object',properties:{},required:[]},expected:{property:'captured',value:true}}};
    td.flolah.evidence={visual:true,kind:'simulator_snapshot'};
  } else if (kind === 'sensor') td.properties={temperature:{type:'number'}};
  else if (kind === 'robot') {
    td.flolah.taskLifecycle={progress:true,outcomes:true,cancellation:true};
    td.properties={task_state:{type:'string'}};
    td.actions={clean_area:{risk:'approval_required',task:true,input:{type:'object',properties:{areaId:{type:'string',minLength:1,maxLength:64}},required:['areaId']},expected:{property:'task_state',value:'completed'}}};
  } else throw fault('Unsupported profile');
  if(kind==='camera')td.actions.capture.output={version:1,schema:{type:'object',properties:{frame:{...imageReferenceSchema(),title:'Captured frame'},captured_at:{type:'number',title:'Capture timestamp'}},required:['frame','captured_at']},bindings:{frame:{source:'evidence_image',index:0},captured_at:{source:'observation_time'}}};
  if(kind==='tv')for(const [name,spec]of Object.entries(td.actions)){const key={set_power:'power_state',launch_app:'active_app',select_channel:'selected_channel',navigate:'navigation'}[name];spec.output={version:1,schema:{type:'object',properties:{[key]:{...td.properties[spec.expected.property],title:key},reported_at:{type:'number'}},required:[key,'reported_at']},bindings:{[key]:{source:'observation_value'},reported_at:{source:'observation_time'}}};}
  return validateDescription(td);
}
export function validateCommand(command, entity, now = Date.now()) {
  object(command); id(command.id); id(command.entityId); id(command.action);
  if (command.entityId !== entity.id || command.descriptionHash !== fingerprint(entity.description)) throw fault('Capability version mismatch',409);
  const spec = entity.description.actions[command.action];
  if (!spec) throw fault('Unsupported capability');
  if (spec.risk === 'prohibited' || command.authorized !== true || command.expiresAt <= now || command.expiresAt > now + 300_000) throw fault('Invalid or expired authority',403);
  validateInput(spec.input, command.input);
  return spec;
}
