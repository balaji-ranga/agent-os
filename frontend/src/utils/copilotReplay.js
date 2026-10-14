// Recordings describe intent, not executable selectors or saved field values.
export function replayStep(recipe,version,index){
  if(recipe.status!=='published'||recipe.version!==version)throw Error('This recording changed or was archived. Start replay again from its latest published version.');
  const step=recipe.steps[index];
  if(!step)throw Error('No recorded step is available.');
  return step;
}
export function replayMatches(step,path){
  if(typeof path!=='string')return false;
  const actual=path.split(/[?#]/)[0].split('/'),expected=step.path.split('/');
  return actual.length===expected.length&&expected.every((part,i)=>[':record',':id'].includes(part)?/^[a-zA-Z0-9-]+$/.test(actual[i]):part===actual[i]);
}
export function replayPrompt(recipe,index){
  const step=replayStep(recipe,recipe.version,index);
  return `Replay recording "${recipe.title}", version ${recipe.version}, step ${index+1}: ${step.instruction}\nExpected result: ${step.success}\nInspect the current screen. Use this as guidance only, not permission. Ask me for current field values that are missing. Prepare changes for review; do not save, create or submit without the existing approval flow.`;
}
