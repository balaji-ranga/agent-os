// This contract validates proposals; exact-state approval still precedes writes.
export function responseContract(snapshot){
 return {output:{message:'string up to 4000 characters',actions:'zero to ten action instances'},
  actionShapes:{fill:{type:'fill',ref:'exact current field ref',value:'string'},highlight:{type:'highlight',ref:'exact current field ref'},navigate:{type:'navigate',ref:'exact observed safe link ref; sole action'}},
  fields:snapshot.fields.map(({ref,label,type})=>({ref,label,type})),links:snapshot.links,
  policy:'Field refs, link refs and persistent map keys are separate namespaces. Source-map fields are hints only. Navigate using an observed safe link and inspect the destination before preparing off-screen fields. Never invent refs, options or writes.'};
}
export function parseAssistantResponse(content,snapshot){
 if(typeof content!=='string'||content.length>32_000)throw new Error('invalid_response_shape');
 const text=content.trim(),fenced=/^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(text);
 let result;try{result=JSON.parse(fenced?fenced[1]:text);}catch{throw new Error('invalid_json');}
 if(!result||Array.isArray(result)||typeof result.message!=='string'||result.message.length>4000||!Array.isArray(result.actions)||result.actions.length>10||Object.keys(result).some(k=>!['message','actions'].includes(k)))throw new Error('invalid_response_shape');
 const used=new Set();
 for(const action of result.actions){
  if(!action||Array.isArray(action)||!['fill','highlight','navigate'].includes(action.type))throw new Error('unsupported_action');
  const keys=action.type==='fill'?['type','ref','value']:['type','ref'];
  if(Object.keys(action).some(k=>!keys.includes(k))||used.has(action.ref))throw new Error('invalid_action_shape');used.add(action.ref);
  if(action.type==='navigate'){
   if(result.actions.length!==1||!snapshot.links.some(l=>l.ref===action.ref))throw new Error('unobserved_navigation');
  }else{
   const field=snapshot.fields.find(f=>f.ref===action.ref);if(!field)throw new Error('unobserved_field');
   if(action.type==='fill'&&(typeof action.value!=='string'||action.value.length>8000||field.type==='checkbox'&&!['true','false'].includes(action.value)))throw new Error('invalid_field_value');
  }
 }
 return result;
}
