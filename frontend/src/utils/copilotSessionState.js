// Navigation/refresh requests can finish after a newer proposal or fill receipt.
// Never replace a newer version of the same assistance session with an old read.
export function newerCopilotSession(current,next){
  if(current?.id===next?.id&&Number.isInteger(current?.version)&&Number.isInteger(next?.version)&&next.version<current.version)return current;
  return next;
}
