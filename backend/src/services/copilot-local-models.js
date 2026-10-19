// Private registered model selection; never accepts provider URLs or secrets
// from a visitor or the model. Shared efficiency/reasoning deployments stay intact.
export function privateCopilotModel(row){
 if(!row||!row.enabled||!row.model||/cloud/i.test(row.model))return false;
 try{const u=new URL(row.base_url);return ['http:','https:'].includes(u.protocol)&&['ollama','localhost','127.0.0.1','[::1]'].includes(u.hostname)&&!u.username&&!u.password&&!u.search&&!u.hash;}catch{return false;}
}
