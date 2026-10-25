import { createHash, randomBytes } from 'node:crypto';

export function fail(status, code, message) { throw Object.assign(new Error(message), { status, code }); }
const hash = value => createHash('sha256').update(String(value || '')).digest('hex');
const token = () => randomBytes(32).toString('base64url');
export function normalizePhone(value) {
  const phone = String(value || '').replace(/[\s()-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) fail(400, 'invalid_phone', 'Use the international format, for example +65 8123 4567.');
  return phone;
}
export function initializeFloAssist(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS floassist_verifications (
    token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, phone TEXT NOT NULL, country TEXT NOT NULL,
    code_hash TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, owner_id TEXT,
    consent_json TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS floassist_profiles (
    owner_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, phone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'onboarding', preferences_json TEXT NOT NULL,
    consent_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS floassist_access (
    token_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS floassist_resources (
    owner_id TEXT NOT NULL, kind TEXT NOT NULL, resource_key TEXT NOT NULL, resource_id TEXT NOT NULL,
    PRIMARY KEY(owner_id,kind,resource_key));
    CREATE TABLE IF NOT EXISTS floassist_locks (key TEXT PRIMARY KEY, lease TEXT NOT NULL, expires_at INTEGER NOT NULL);`);
}
/** Restricted setup tokens cannot log into Flolah. Owner and COO identity always come from the session. */
export function createFloAssist({ db, product, adapters:a, now=Date.now }) {
  initializeFloAssist(db);
  const config=()=>({...product.defaults,...a.settings()});
  function purge(){
    for(const table of ['floassist_verifications','floassist_access','floassist_locks']) db.prepare(`DELETE FROM ${table} WHERE expires_at<=?`).run(now());
  }
  async function locked(key,fn){
    const lease=token();
    const acquired=db.prepare(`INSERT INTO floassist_locks(key,lease,expires_at) VALUES (?,?,?)
      ON CONFLICT(key) DO UPDATE SET lease=excluded.lease,expires_at=excluded.expires_at WHERE expires_at<=?`)
      .run(key,lease,now()+300000,now()).changes;
    if(!acquired) fail(409,'busy','Setup is already in progress. Please try again shortly.');
    try{return await fn();}finally{db.prepare('DELETE FROM floassist_locks WHERE key=? AND lease=?').run(key,lease);}
  }
  function publicConfig(){return {name:product.name,countries:product.countries,connectors:product.connectors,
    responsibilities:product.responsibilities.map(({id,label})=>({id,label})),enabled:config().enabled!==false,
    legal:a.legal(),management_url:a.managementUrl(),
    privacy:'FloAssist uses Flolah and your linked WhatsApp channel. Conversation, task and audit records follow Flolah retention settings. Connector providers retain their own records. This version does not promise zero retention.'};}
  function owner(id){const u=a.findOwner({id});if(!u?.enabled||u.role!=='ceo')fail(403,'account_unavailable','This account is unavailable.');return u;}
  function profile(id){
    owner(id);const p=db.prepare('SELECT * FROM floassist_profiles WHERE owner_id=?').get(id);
    if(!p)fail(404,'not_enrolled','Complete FloAssist setup first.');
    a.assertCoo(id,p.agent_id);return {...p,preferences:JSON.parse(p.preferences_json)};
  }
  function session(value){
    const row=db.prepare('SELECT owner_id FROM floassist_access WHERE token_hash=? AND expires_at>?').get(hash(value),now());
    if(!row)fail(401,'session_expired','Verify your email again to continue setup.');return profile(row.owner_id);
  }
  function preferences(input={},previous={}){
    const p={task_realert_hours:24,notification_batch_minutes:5,followup_wait_hours:48,connectors:[],responsibilities:product.responsibilities.map(r=>r.id),timezone:'Asia/Singapore',briefing_time:'09:00',quiet_start:'22:00',quiet_end:'08:00',...previous};
    for(const k of Object.keys(p))if(input[k]!==undefined)p[k]=input[k];
    for(const key of ['connectors','responsibilities']){
      if(!Array.isArray(p[key])||p[key].some(id=>!product[key].some(r=>r.id===id)))fail(400,'selection','Choose an available option.');
      p[key]=[...new Set(p[key])];
    }
    if(!Number.isInteger(p.task_realert_hours)||p.task_realert_hours<0||p.task_realert_hours>720)fail(400,'realert','Task reminder interval must be between 0 and 720 hours.');
    if(!Number.isInteger(p.notification_batch_minutes)||p.notification_batch_minutes<0||p.notification_batch_minutes>60)fail(400,'batch','Notification grouping must be between 0 and 60 minutes.');
    if(!Number.isInteger(p.followup_wait_hours)||p.followup_wait_hours<1||p.followup_wait_hours>720)fail(400,'followup','Follow-up wait must be between 1 and 720 hours.');
    if(typeof p.timezone!=='string')fail(400,'timezone','Choose a valid timezone.');
    try{new Intl.DateTimeFormat('en',{timeZone:p.timezone}).format();}catch{fail(400,'timezone','Choose a valid timezone.');}
    for(const k of ['briefing_time','quiet_start','quiet_end'])if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(p[k]))fail(400,'time','Enter a valid time.');
    return p;
  }
  async function start(input={}){
    purge();if(config().enabled===false)fail(503,'disabled','FloAssist registration is temporarily unavailable.');
    const email=String(input.email||'').trim().toLowerCase(),phone=normalizePhone(input.phone);
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)fail(400,'email','Enter a valid email address.');
    if(!product.countries.includes(input.country))fail(400,'country','Choose a supported country.');
    if(input.accept_terms!==true||input.whatsapp_opt_in!==true)fail(400,'consent','Accept the terms and WhatsApp messages to continue.');
    const value=token(),otp=a.newOtp(),legal=a.legal();
    const consent={terms_version:legal.terms_version,privacy_version:legal.privacy_version,whatsapp_opt_in:true,accepted_at:now()};
    db.prepare(`INSERT INTO floassist_verifications(token_hash,email,phone,country,code_hash,consent_json,expires_at) VALUES (?,?,?,?,?,?,?)`)
      .run(hash(value),email,phone,input.country,otp.codeHash,JSON.stringify(consent),now()+config().challenge_minutes*60000);
    try{await a.sendEmail(email,otp.code,config().challenge_minutes);}catch{
      db.prepare('DELETE FROM floassist_verifications WHERE token_hash=?').run(hash(value));fail(503,'email_unavailable','We could not send your code. Please try again.');}
    return {session_token:value};
  }
  async function verify(value,code,mfaCode){
    const prior=db.prepare('SELECT owner_id FROM floassist_access WHERE token_hash=? AND expires_at>?').get(hash(value),now());
    if(prior)return view(prior.owner_id);
    const row=db.prepare('SELECT * FROM floassist_verifications WHERE token_hash=? AND expires_at>?').get(hash(value),now());
    if(!row)fail(401,'expired','Your code expired. Request a new code.');
    if(row.attempts>=config().challenge_attempts)fail(429,'attempts','Too many attempts. Request a new code.');
    db.prepare('UPDATE floassist_verifications SET attempts=attempts+1 WHERE token_hash=?').run(hash(value));
    if(!a.matchesOtp(code,row.code_hash))fail(401,'invalid_code','That code is incorrect. Try again.');
    return locked(`email:${hash(row.email)}`,async()=>{
      let user=a.findOwner({email:row.email});
      if(user){owner(user.id);a.verifyMfa(user,mfaCode);}
      if(user?.mobile&&normalizePhone(user.mobile)!==row.phone)fail(409,'phone_mismatch','Use the personal phone number already saved in your Flolah account.');
      const isNew=!user;
      if(!user){
        user=await a.createOwner({...row,...JSON.parse(row.consent_json)});
        db.prepare('UPDATE floassist_verifications SET owner_id=? WHERE token_hash=?').run(user.id,hash(value));
      }
      const agent=a.resolveCoo(user.id);
      const existing=db.prepare('SELECT * FROM floassist_profiles WHERE owner_id=?').get(user.id);
      if(existing&&existing.phone!==row.phone)fail(409,'phone_mismatch','Use the personal phone number already linked to FloAssist.');
      if(isNew||row.owner_id===user.id)a.setPolicy(user.id,agent.id,{preset:'advisory',financial:'prohibited'});
      const prefs=preferences({timezone:product.timezones[row.country]});
      db.transaction(()=>{
        db.prepare(`INSERT INTO floassist_profiles(owner_id,agent_id,phone,preferences_json,consent_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(owner_id) DO NOTHING`)
          .run(user.id,agent.id,row.phone,JSON.stringify(prefs),row.consent_json,now(),now());
        db.prepare('INSERT OR REPLACE INTO floassist_access VALUES (?,?,?)').run(hash(value),user.id,now()+config().session_minutes*60000);
        db.prepare('DELETE FROM floassist_verifications WHERE token_hash=?').run(hash(value));
      })();return view(user.id);
    });
  }
  function view(id){const p=profile(id);return {status:p.status,preferences:p.preferences,policy:a.policy(id,p.agent_id),phone:p.phone,channel:a.channelView(p),management_url:a.managementUrl()};}
  async function save(id,input){return locked(`owner:${id}`,async()=>{
    const p=profile(id),prefs=preferences(input,p.preferences);
    db.prepare('UPDATE floassist_profiles SET preferences_json=?,updated_at=? WHERE owner_id=?').run(JSON.stringify(prefs),now(),id);
    if(p.status==='active')await a.provision(profile(id));return view(id);
  });}
  async function connect(id,provider){const p=profile(id);if(!p.preferences.connectors.includes(provider))fail(400,'connector','Select this app before connecting it.');return a.connect(id,provider);}
  async function connections(id){const p=profile(id);return a.connections(id,p.preferences.connectors);}
  async function qr(id,operation='status'){
    if(operation==='status'||operation==='wait')return a.qr(profile(id),operation);
    return locked(`owner:${id}`,()=>a.qr(profile(id),operation));
  }
  async function activate(id){return locked(`owner:${id}`,async()=>{
    const p=profile(id),ch=a.channelView(p);
    if(!ch.connected)fail(409,'not_paired','Link your dedicated WhatsApp number first.');
    if(ch.number===p.phone)fail(409,'separate_number','Link a separate dedicated number, not your personal WhatsApp number.');
    if(!ch.number)fail(409,'identity_pending','WhatsApp is still confirming the linked number. Check again shortly.');
    const apps=await connections(id);
    if(apps.some(app=>!app.connected))fail(409,'connectors_pending','Connect your selected apps, or deselect them to continue without them.');
    await a.provision(p);
    db.prepare("UPDATE floassist_profiles SET status='active',updated_at=? WHERE owner_id=?").run(now(),id);return view(id);
  });}
  async function setStatus(id,status){
    if(status==='active')return activate(id);
    if(!['paused','stopped'].includes(status))fail(400,'status','Choose pause, stop or resume.');
    return locked(`owner:${id}`,async()=>{const p=profile(id);await a.pause(p,status);
      db.prepare('UPDATE floassist_profiles SET status=?,updated_at=? WHERE owner_id=?').run(status,now(),id);return view(id);});
  }
  function setPolicy(id,input){const p=profile(id);a.setPolicy(id,p.agent_id,input);return view(id);}
  function logout(value){db.prepare('DELETE FROM floassist_access WHERE token_hash=?').run(hash(value));}
  return {publicConfig,start,verify,session,profile,view,save,connect,connections,qr,activate,setStatus,setPolicy,logout,purge};
}
