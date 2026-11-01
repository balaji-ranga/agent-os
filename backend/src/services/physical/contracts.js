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
export function validateDescription(td) {
  object(td); id(td.id);
  if (td['@context'] !== 'https://www.w3.org/2022/wot/td/v1.1' || typeof td.title !== 'string' || td.title.length > 200) throw fault('Invalid WoT profile');
  if (!['PhysicalDevice','PhysicalAgent'].includes(td.flolah?.kind) || typeof td.flolah?.simulated !== 'boolean') throw fault('Missing physical identity metadata');
  object(td.properties); object(td.actions);
  if (Object.keys(td.actions).length > 32 || Object.keys(td.properties).length > 32) throw fault('Too many capabilities');
  for (const [name, spec] of Object.entries(td.actions)) {
    id(name);
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
  } else if (kind === 'sensor') td.properties={temperature:{type:'number'}};
  else if (kind === 'robot') {
    td.flolah.taskLifecycle={progress:true,outcomes:true,cancellation:true};
    td.properties={task_state:{type:'string'}};
    td.actions={clean_area:{risk:'approval_required',task:true,input:{type:'object',properties:{areaId:{type:'string',minLength:1,maxLength:64}},required:['areaId']},expected:{property:'task_state',value:'completed'}}};
  } else throw fault('Unsupported profile');
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
