import {copilotError,validateCopilotProposal} from './ui-copilot-contract.js';

// This is a browser-reported fill receipt, never proof of a saved business
// object and never authority to execute another action. Values come from the
// server's validated proposal, not arbitrary client-supplied record contents.
export function copilotFillReceipt(state,input,catalog){
  if(state.status!=='active')throw copilotError('Resume assistance before recording progress');
  if(!input||!['fill','screen_fill','embed_fill'].includes(input.type)||!input.values||typeof input.values!=='object'||Array.isArray(input.values))throw copilotError('Invalid fill receipt');
  const entries=Object.entries(input.values);
  if(!entries.length||entries.length>20)throw copilotError('Invalid fill receipt');
  const actions=validateCopilotProposal(state.proposal,catalog).actions.filter(a=>a.type===input.type&&a.form===input.form&&a.screen===input.screen&&entries.every(([key,value])=>Object.hasOwn(a.values,key)&&JSON.stringify(a.values[key])===JSON.stringify(value)));
  if(actions.length!==1)throw copilotError('Fill receipt does not match the reviewed proposal');
  const action=actions[0];
  return {type:action.type,...(action.form?{form:action.form}:{}),...(action.screen?{screen:action.screen}:{}),values:Object.fromEntries(entries.map(([key])=>[key,action.values[key]])),labels:action.labels||{},status:'entered_client_reported',saved:false,at:new Date().toISOString()};
}
