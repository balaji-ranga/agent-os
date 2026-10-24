// Only the visitor setting enables autonomy. Model output cannot change it.
const effects=new Set(['navigate','activate','submit']);
export const mayApplyAutomatically=({approvalRequired=true,actions=[],mode='assist'}={})=>approvalRequired===false&&mode==='assist'&&actions.length>0&&(actions.every(a=>a.type==='fill'||a.type==='highlight')||actions.length===1&&effects.has(actions[0].type));
export function automaticOutcomeMessage(actions,results=[]){
 if(actions.every(a=>a.type==='fill'))return 'Automatically applied: '+actions.map(a=>a.label+': '+(a.displayValue||a.value)).join('; ')+'. Save was not clicked.';
 const action=actions[0],outcome=results[0];
 if(action.type==='submit')return outcome?.businessVerified?'Automatically submitted '+action.label+'. Saved record verified.':outcome?.hostReported==='success'?'Automatically submitted '+action.label+'. The host reported success; independent business verification is separate.':'Automatic submission outcome requires inspection. No retry was attempted.';
 return action.type==='navigate'?'Automatically opened '+action.label+'.':action.type==='activate'?'Automatically activated '+action.label+'; the website update was observed.':'Guidance shown automatically.';
}
