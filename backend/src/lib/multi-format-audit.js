import {createHash} from 'node:crypto';
export function multiFormatInputAudit(input={}) {
  const args=input?.params&&input?.tool_name==='multi-format-content-tool'?input.params:input;
  return {operation:String(args?.operation||'convert').slice(0,20),input_format:String(args?.input_format||'').slice(0,20),output_format:String(args?.output_format||'').slice(0,20),
    input_kind:['text','formatted','base64','content_file'].includes(args?.input_kind)?args.input_kind:args?.content_file||args?.relative_path||args?.media_uri?'content_file':args?.content_base64?'base64':args?.formatted_input?'formatted':'text',
    request_sha256:createHash('sha256').update(JSON.stringify(args||{})).digest('hex'),
    ...(typeof args?.input_sha256==='string'&&/^[a-f0-9]{64}$/.test(args.input_sha256)?{input_sha256:args.input_sha256}:{}),
    // Keep broker-stamped correlation; dropping it hides a real call from this chat turn.
    ...Object.fromEntries(['_chat_turn_id','_work_unit_id','_delegation_task_id'].filter(key=>typeof input?.[key]==='string'&&input[key].length<=200).map(key=>[key,input[key]]))};
}
