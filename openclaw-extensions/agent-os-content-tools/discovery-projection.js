// Model-only progressive disclosure. Execution results and the backend audit stay intact.
// Discovery lists capabilities; the selected capability's guide supplies its schema.
export function projectDiscoveryResult(name, data) {
  if (!data || typeof data !== 'object' || data.ok === false || data.error) return data;
  if (name === 'connector_search_actions' && Array.isArray(data.actions)) {
    return {
      ...data,
      actions: data.actions.map(action => {
        if (!action || typeof action !== 'object' || !action.guide_call) return action;
        const {input_schema, example_input, ...descriptor} = action;
        return descriptor;
      }),
      schema_discovery: 'Input schemas and examples are available through each action guide_call. Read the selected guide before execution; do not infer arguments from discovery descriptions.',
    };
  }
  if (name === 'connector_get_action_guide' && data.raw && typeof data.raw === 'object' && !Array.isArray(data.raw)) {
    const aliases = {inputSchema:'input_schema', input_schema:'input_schema', outputSchema:'output_schema', output_schema:'output_schema', description:'description'};
    const raw = Object.fromEntries(Object.entries(data.raw).filter(([key,value]) => {
      const target = aliases[key];
      return !target || JSON.stringify(value) !== JSON.stringify(data[target]);
    }));
    return {...data, raw};
  }
  return data;
}

// Replay uses the same projection for previously recorded catalog results.
// No transcript writes: raw audit, source bodies, media and call correlations survive.
export function projectDiscoveryMessages(messages) {
  if (!Array.isArray(messages)) return messages;
  return messages.map(message => {
    if (message?.role !== 'toolResult' || message.isError || !Array.isArray(message.content)) return message;
    let changed=false;
    const content=message.content.map(block => {
      if(block?.type!=='text')return block;
      try {
        const wrapper=JSON.parse(block.text);
        const name=wrapper.tool?.name;
        if(!['connector_search_actions','connector_get_action_guide'].includes(name)||wrapper.result?.isError||!Array.isArray(wrapper.result?.content))return block;
        let innerChanged=false;
        const inner=wrapper.result.content.map(item=>{
          if(item?.type!=='text')return item;
          try {const data=JSON.parse(item.text),projected=projectDiscoveryResult(name,data);
            if(projected===data)return item;
            const text=JSON.stringify(projected);if(text.length>=item.text.length)return item;
            innerChanged=true;return {...item,text};
          }catch{return item;}
        });
        if(!innerChanged)return block;
        changed=true;return {...block,text:JSON.stringify({...wrapper,result:{...wrapper.result,content:inner}})};
      }catch{return block;}
    });
    return changed?{...message,content}:message;
  });
}
