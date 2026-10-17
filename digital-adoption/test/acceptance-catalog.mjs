// Release journeys, not a claim that unit tests certify end-to-end behavior.
// Evidence must name the build/environment and observable outcome per journey.
export const acceptanceCases = [
 ['F01',1,'Registration, approval, installation and isolated index'],
 ['F02',1,'Pending, denied, suspended, expired and removed installations'],
 ['F03',1,'Exact origin, environment and organization boundaries'],
 ['F04',1,'Placement, mobile, exclusions, mount lifecycle and continuity'],
 ['F05',1,'Idempotent registration and provisioning retries'],
 ['F06',1,'Distinct initialization and same-operation retries'],
 ['F07',1,'Chat, draft, approval, stream and cache isolation'],
 ['F08',1,'SPA/reopen/reply/renew continuity without stale approval reuse'],
 ['F09',1,'Reload/navigation/new tab/reinitialization starts empty'],
 ['F10',1,'Credential, idle and absolute expiry; sign-out and termination'],
 ['F11',1,'Rotation overlap, session/install/website revocation and audit'],
 ['F12',1,'Management permission denial including direct requests'],
 ['F13',1,'PDF/DOCX/text/HTML/image ingestion, OCR and cross-session RAG'],
 ['F14',1,'Safe URL crawl, refresh, citations and deletion'],
 ['F15',1,'Sharing notice, upload permissions and quarantine'],
 ['F16',1,'Chat clearing is independent from shared source deletion'],
 ['F17',1,'Ingestion interruption, retry, limits and chunk deduplication'],
 ['F18',1,'Grounded/paraphrased/unsupported/conflicting evidence'],
 ['F19',2,'Ask/Guide no writes; knowledge-only no DOM'],
 ['F20',2,'Native/SPA review, filling, separate save and verified outcome'],
 ['F21',2,'Pointer profile single activation and destination verification'],
 ['F22',2,'Stale values, permissions, targets and versions rejected'],
 ['F23',2,'Autosave effects approved without duplicated effects'],
 ['F24',2,'Cursor/highlights/status/reduced motion and truthful outcome'],
 ['F25',2,'Pause/stop/edit/navigation/revocation/disconnection interruption'],
 ['F26',2,'SPA/shadow/custom/frame/gesture compatibility and fallback'],
 ['F27',2,'Record, parameterize, validate, publish and deny visitor publish'],
 ['F28',2,'Video upload and consented capture/review/discard'],
 ['F29',2,'Timestamped video RAG and validated recipe draft'],
 ['F30',2,'Independent parameterized recipe replay and drift pause'],
 ['F31',2,'Mapped staging-to-production learning promotion'],
 ['F32',2,'Import retries/conflicts/schema rejection and immutable rollback'],
 ['F37',2,'Bounded safe autonomous discovery without writes or draft loss'],
 ['F38',2,'New ordinary form without form-specific code deployment'],
 ['F39',2,'Changed form, fresh review, repair publication and rollback'],
 ['F40',2,'Opt-in verified learning, privacy and scoped automatic matching'],
 ['F41',2,'Self-service controls and role/tenant/session boundaries'],
 ['F42',2,'CRM Opportunity/Note, ERP Customer, scheduled goal and unrelated form'],
].map(([id,phase,title])=>Object.freeze({id,phase,title}));

export function evaluateRelease(evidence) {
 const missing=[];
 for(const item of acceptanceCases){
  for(const environment of ['local','vps']){
   const proof=evidence.findLast(e=>e.id===item.id&&e.environment===environment);
   if(!proof||proof.status!=='passed'||!proof.build||!proof.artifact||proof.kind!=='end-to-end'||proof.fullRequirementCovered!==true) missing.push(`${item.id}:${environment}`);
  }
 }
 return {readyForUat:missing.length===0,missing};
}
