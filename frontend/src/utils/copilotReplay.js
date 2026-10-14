import {waitForCopilotReady,hasCopilotEmbedControls,matchesCopilotDestination} from './copilotNavigation.js';
// Recordings describe intent, not executable selectors or saved field values.
export async function openReplayDestination({step,screen,currentPath,navigate,inspect,navigateEmbedded,isCurrent=()=>true,wait=waitForCopilotReady}){
  if(!screen||screen.id!==step.screen)throw Error('This screen is no longer available.');
  const route=screen.route.split(/[?#]/)[0],embedded=['crm','erp'].includes(screen.id);
  if(!isCurrent())throw Error('The assistance context changed.');
  if(currentPath()!==route)await navigate(screen.route);
  const observed=await wait({stableSamples:2,isCurrent,inspect:async()=>currentPath()===route?(embedded?await inspect():{path:screen.route}):null,accept:m=>!!m&&(!embedded||hasCopilotEmbedControls(m))});
  if(!embedded||replayMatches(step,observed.path))return;
  if(step.path.includes(':'))throw Error('Choose the current record first. Record IDs are intentionally not stored in recordings.');
  const destinations=(observed.navigation||[]).filter(n=>replayMatches(step,n.path));
  if(destinations.length!==1)throw Error('The recorded destination is not uniquely visible. Ask Copilot for help; no guessed link was opened.');
  await navigateEmbedded(destinations[0].path);
  await wait({stableSamples:2,isCurrent,inspect,accept:m=>hasCopilotEmbedControls(m)&&matchesCopilotDestination(m.path,destinations[0].path)});
}
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
