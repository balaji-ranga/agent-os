import { createHash, randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
const fail = () => { throw new Error('Access denied'); };
const token = prefix => `${prefix}${randomBytes(32).toString('base64url')}`;
function originOf(value, development = false) {
  try {
    const u = new URL(value);
    const local = development && u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname);
    if ((!local && u.protocol !== 'https:') || u.username || u.password || u.pathname !== '/' || u.search || u.hash) fail();
    return u.origin;
  } catch { fail(); }
}

// Trusted domain API, not an HTTP authorization layer. Never expose registerApproved
// or revokeInstallation directly to an unauthenticated caller.
export class SessionAuthority {
  #installations = new Map();
  #sessions = new Map();
  #runtime = new Map();
  #initializations = new Map();
  #clock;
  #transaction;
  #development;
  #idleMs;
  #hostIdentity;
  #proposals;
  constructor({ clock = Date.now, repository, development = false, idleMs = 15 * 60_000,hostIdentity } = {}) {
    if (!Number.isSafeInteger(idleMs) || idleMs < 60_000 || idleMs > 30 * 60_000) fail();
    this.#idleMs = idleMs;
    this.#clock = clock;
    this.#development = development;
    this.#hostIdentity=hostIdentity;
    this.#transaction = repository ? fn => repository.transaction(fn) : fn => fn();
    if (repository) {
      this.#installations = repository.map('installations');
      this.#sessions = repository.map('sessions');
      this.#runtime = repository.map('runtime');
      this.#initializations = repository.map('initializations');
      this.#revoked = repository.map('revocations');
      this.#proposals = repository.map('proposals');
    }
  }

  registerApproved({ embeddingId, origins, expiresAt, visibility = 'public', visitorUploads = false }) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(embeddingId) || !Array.isArray(origins) || !origins.length ||
        origins.length > 20 || !Number.isSafeInteger(expiresAt) || expiresAt <= this.#clock() || visibility !== 'public' || typeof visitorUploads!=='boolean') fail();
    const allowed = [...new Set(origins.map(value => originOf(value, this.#development)))];
    const secret = token('dac_install_');
    const id = randomUUID();
    this.#installations.set(digest(secret), { id, embeddingId, origins: allowed, expiresAt, revoked: false, visitorUploads });
    return { installationId: id, installationToken: secret };
  }

  installationSummary(embeddingId) {
    return [...this.#installations.values()].filter(i=>i.embeddingId===embeddingId).map(i=>({id:i.id,maskedId:`…${i.id.slice(-8)}`,expiresAt:i.expiresAt,status:this.#revoked.get(i.id)||i.revoked?'revoked':i.expiresAt<=this.#clock()?'expired':'active'}));
  }

  setUploadPolicy(embeddingId,enabled){
    if(typeof enabled!=='boolean')fail();
    for(const [key,installation] of this.#installations.entries({embeddingId}))if(installation.embeddingId===embeddingId){installation.visitorUploads=enabled;this.#installations.set(key,installation);}
  }

  grantCoaching(auth,grant){
    return this.#transaction(()=>{
    const {session}=this.#authorize(auth.sessionToken,auth.origin);
    if(grant?.embeddingId!==session.embeddingId||grant.origin!==session.origin||!Number.isSafeInteger(grant.expiresAt)||grant.expiresAt<=this.#clock()||grant.expiresAt>this.#clock()+10*60_000)fail();
    if(grant.audienceId&&! (session.identity?.audienceIds||['public']).includes(grant.audienceId))fail();
    session.coachingAudienceId=grant.audienceId||'public';session.coachingUntil=Math.min(grant.expiresAt,session.expiresAt);this.#sessions.set(session.id,session);return {coachingUntil:session.coachingUntil};
    });
  }

  #installation(secret, origin) {
    if (typeof secret !== 'string' || secret.length > 256) fail();
    const entry = this.#installations.get(digest(secret));
    if (!entry || entry.revoked || this.#revoked.get(entry.id) || entry.expiresAt <= this.#clock() || !entry.origins.includes(originOf(origin, this.#development))) fail();
    return entry;
  }

  initialize({ installationToken, origin, initializationKey,identityToken }) {
    return this.#transaction(() => {
    const installation = this.#installation(installationToken, origin);
    const identity=this.#hostIdentity?.verify(installation.embeddingId,origin,identityToken)||null;
    if(identityToken!==undefined&&!this.#hostIdentity)fail();
    // A fresh SDK instance generates a 256-bit in-memory operation secret.
    // Retries recover its response without storing a plaintext bearer token.
    if (initializationKey !== undefined && !/^[a-f0-9]{64}$/.test(initializationKey)) fail();
    const operation = initializationKey && digest(`${installation.id}\n${originOf(origin,this.#development)}\n${initializationKey}`);
    const key = initializationKey && createHash('sha256').update(`adoption-init-v1:${initializationKey}`).digest();
    const cached = operation && this.#initializations.get(operation);
    if (cached) {
      if(cached.expiresAt<=this.#clock()||(cached.identityFingerprint||null)!==(identity?.fingerprint||null)) fail();
      const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(cached.iv,'hex'));
      decipher.setAAD(Buffer.from(operation));decipher.setAuthTag(Buffer.from(cached.tag,'hex'));
      const result=JSON.parse(Buffer.concat([decipher.update(Buffer.from(cached.content,'hex')),decipher.final()]).toString());
      this.#authorize(result.sessionToken,origin); // Never revive renewed/revoked/ended sessions.
      return result;
    }
    const session = { id: randomUUID(), installationId: installation.id, embeddingId: installation.embeddingId,
      origin: originOf(origin, this.#development),identity, messages: [], lastActivityAt: this.#clock(), expiresAt: Math.min(installation.expiresAt,this.#clock() + 30 * 60_000), terminated: false };
    this.#sessions.set(session.id, session);
    const result=this.#issue(session, installation);
    if(operation){
      const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
      cipher.setAAD(Buffer.from(operation));
      const content=Buffer.concat([cipher.update(JSON.stringify(result)),cipher.final()]);
      this.#initializations.set(operation,{sessionId:session.id,iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),content:content.toString('hex'),identityFingerprint:identity?.fingerprint||null,expiresAt:result.expiresAt});
    }
    return result;
    });
  }

  #issue(session, installation) {
    const secret = token('dac_session_');
    const expiresAt = Math.min(this.#clock() + 5 * 60_000, installation.expiresAt, session.expiresAt,session.identity?.expiresAt||Infinity);
    this.#runtime.set(digest(secret), { sessionId: session.id, expiresAt });
    return { sessionId: session.id, sessionToken: secret, expiresAt, sessionExpiresAt:session.expiresAt,
      idleExpiresAt:session.lastActivityAt + this.#idleMs };
  }

  #authorize(secret, origin) {
    if (typeof secret !== 'string' || secret.length > 256) fail();
    const credential = this.#runtime.get(digest(secret));
    const session = credential && this.#sessions.get(credential.sessionId);
    const installation = session && [...this.#installations.values({embeddingId:session.embeddingId})].find(i => i.id === session.installationId);
    if (!credential || credential.expiresAt <= this.#clock() || !session || session.terminated ||
        session.expiresAt <= this.#clock() || !Number.isSafeInteger(session.lastActivityAt) || session.lastActivityAt + this.#idleMs <= this.#clock() || session.origin !== originOf(origin, this.#development) ||
        !installation || installation.revoked || this.#revoked.get(installation.id) || installation.expiresAt <= this.#clock()) fail();
    this.#hostIdentity?.check(session.embeddingId,session.identity);
    return { session, installation };
  }

  renew({ sessionToken, origin,identityToken }) {
    return this.#transaction(() => {
    const { session, installation } = this.#authorize(sessionToken, origin);
    if(identityToken!==undefined){
      const identity=this.#hostIdentity?.verify(session.embeddingId,origin,identityToken);
      if(!identity||identity.fingerprint!==session.identity?.fingerprint)fail();session.identity=identity;this.#sessions.set(session.id,session);
    }
    this.#runtime.delete(digest(sessionToken));
    return this.#issue(session, installation);
    });
  }

  appendMessage({ sessionToken, origin, text, replyTo = null, channel = 'guide' }) {
    return this.#transaction(() => {
    const { session } = this.#authorize(sessionToken, origin);
    if (!['guide','knowledge'].includes(channel)||typeof text !== 'string' || !text.trim() || text.length > 8000 || session.messages.length >= 200 ||
        (replyTo !== null && !session.messages.some(m => m.id === replyTo&&(m.channel||'guide')===channel))) fail();
    const message = { id: randomUUID(), role: 'user', text, replyTo, channel };
    session.messages.push(message);
    session.lastActivityAt = this.#clock();
    this.#sessions.set(session.id, session);
    return structuredClone(message);
    });
  }

  history({ sessionToken, origin }) {
    return structuredClone(this.#authorize(sessionToken, origin).session.messages);
  }

  clearConversation(auth) {
    return this.#transaction(()=>{
    const {session}=this.#authorize(auth.sessionToken,auth.origin);
    session.messages=[];session.conversationVersion=(session.conversationVersion||0)+1;
    this.#sessions.set(session.id,session);return {cleared:true};
    });
  }

  appendAssistant(auth,text,channel='guide') {
    return this.#transaction(()=>{
    const {session}=this.#authorize(auth.sessionToken,auth.origin);
    if(!['guide','knowledge'].includes(channel)||typeof text!=='string'||text.length>8000||session.messages.length>=200)fail();
    const message={id:randomUUID(),role:'assistant',text,replyTo:null,channel};
    session.messages.push(message);this.#sessions.set(session.id,session);return structuredClone(message);
    });
  }

  // Call for explicit user interactions only. Renewal, polling and background
  // reads must never keep an unattended session alive.
  touch(auth) {
    return this.#transaction(()=>{
    const { session } = this.#authorize(auth.sessionToken,auth.origin);
    session.lastActivityAt=this.#clock();
    this.#sessions.set(session.id,session);
    });
  }

  terminate({ sessionToken, origin }) {
    return this.#transaction(()=>{
    const { session } = this.#authorize(sessionToken, origin);
    session.terminated = true;
    session.messages = [];
    this.#sessions.set(session.id, session);
    });
  }

  revokeInstallation(installationId) {
    const installation = [...this.#installations.values()].find(i => i.id === installationId);
    if (!installation) fail();
    this.#revoked.set(installationId, true);
  }

  // Trusted management operations. A replacement never inherits revocation
  // state, and the original credential cannot have its lifetime extended.
  rotateInstallation(installationId, { overlapMs = 0, expiresAt }) {
    if (!Number.isSafeInteger(overlapMs) || overlapMs < 0 || overlapMs > 7 * 24 * 3_600_000) fail();
    const entries = [...this.#installations.values()];
    const old = entries.find(i => i.id === installationId);
    if (!old || old.revoked || this.#revoked.get(old.id) || old.expiresAt <= this.#clock()) fail();
    const replacement=this.registerApproved({embeddingId:old.embeddingId,origins:old.origins,expiresAt,visitorUploads:old.visitorUploads===true});
    // Locate its hashed storage key without retaining the publishable token.
    for (const [key,value] of this.#installations.entries()) {
      if(value.id===old.id) {value.expiresAt=Math.min(value.expiresAt,this.#clock()+overlapMs);this.#installations.set(key,value);break;}
    }
    return replacement;
  }

  revokeSession(embeddingId, sessionId) {
    return this.#transaction(()=>{
    const session=this.#sessions.get(sessionId);
    if(!session || session.embeddingId!==embeddingId) fail();
    session.terminated=true;session.messages=[];this.#sessions.set(session.id,session);
    });
  }

  #revoked = new Map();

  // Trusted live-connection revalidation; never exposed as a lookup API.
  activeScope(scope){
    const session=this.#sessions.get(scope?.sessionId);
    const installation=session&&[...this.#installations.values({embeddingId:session.embeddingId})].find(i=>i.id===session.installationId);
    if(!session||session.embeddingId!==scope.embeddingId||session.origin!==scope.origin||session.terminated||session.expiresAt<=this.#clock()||session.lastActivityAt+this.#idleMs<=this.#clock()||!installation||installation.revoked||this.#revoked.get(installation.id)||installation.expiresAt<=this.#clock())return false;
    try{this.#hostIdentity?.check(session.embeddingId,session.identity);return true;}catch{return false;}
  }

  // Access expires immediately; bounded maintenance removes private session
  // data independently of the shared website's knowledge lifecycle.
  maintain({limit=500}={}){
    if(!Number.isSafeInteger(limit)||limit<1||limit>5000)fail();
    return this.#transaction(()=>{
      const now=this.#clock(),expired=new Set();
      for(const session of this.#sessions.values())if(expired.size<limit&&(session.terminated||session.expiresAt<=now||session.lastActivityAt+this.#idleMs<=now||session.identity?.expiresAt<=now))expired.add(session.id);
      for(const id of expired)this.#sessions.delete(id);
      let credentials=0,initializations=0,proposals=0;
      for(const [key,row] of this.#runtime.entries())if(row.expiresAt<=now||expired.has(row.sessionId)){this.#runtime.delete(key);credentials++;}
      for(const [key,row] of this.#initializations.entries())if(row.content&&(row.expiresAt<=now||expired.has(row.sessionId))){this.#initializations.set(key,{expiresAt:Math.min(row.expiresAt,now),expired:true});initializations++;}
      for(const [key,row] of this.#proposals?.entries()||[])if(expired.has(row.sessionId)){this.#proposals.delete(key);proposals++;}
      return {sessions:expired.size,credentials,initializations,proposals};
    });
  }

  context({ sessionToken, origin }) {
    const { session,installation } = this.#authorize(sessionToken, origin);
    const coach=(session.coachingUntil||0)>this.#clock();
    const signedAudiences=session.identity?.audienceIds||['public'],audienceIds=coach?[session.coachingAudienceId||signedAudiences[0]]:signedAudiences;
    return Object.freeze({ embeddingId: session.embeddingId, sessionId: session.id,origin:session.origin,audienceId:coach?session.coachingAudienceId||audienceIds[0]:audienceIds[0],audienceIds,hostPrincipal:session.identity?.principal||null,conversationVersion:session.conversationVersion||0,capabilities:{upload:installation.visitorUploads===true||coach,coach} });
  }
}
