const PROTOCOL_VERSION = 1;
const DRIVER_MODE = 'chrome_extension';
const POLL_ALARM = 'flolah-job-poll';
let polling = false;

const storageGet = (keys) => chrome.storage.local.get(keys);
const storageSet = (value) => chrome.storage.local.set(value);

async function state() {
  const value = await storageGet(['baseUrl', 'token', 'nodeId', 'allowedTabs', 'taskTabs', 'online']);
  if (!value.nodeId) {
    value.nodeId = crypto.randomUUID();
    await storageSet({ nodeId: value.nodeId });
  }
  return { ...value, allowedTabs: value.allowedTabs || {}, taskTabs: value.taskTabs || {} };
}
async function activeTab() {
  return (await chrome.tabs.query({ active: true, currentWindow: true }))[0] || null;
}
async function api(path, { method = 'GET', body = null, auth = true } = {}) {
  const s = await state();
  const base = String(s.baseUrl || '').replace(/\/$/, '').replace(/\/api$/i, '');
  if (!base) throw new Error('Flolah address is not configured');
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (auth && s.token) headers.Authorization = `Bearer ${s.token}`;
  const response = await fetch(`${base}/api/browser-worker/v1${path}`, {
    method, headers, body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
  return json;
}
function capabilities() {
  return {
    protocol_version: PROTOCOL_VERSION,
    actions: ['open', 'snapshot', 'act', 'action_batch', 'status', 'wait'],
    structured_snapshot: true,
    action_batch: true,
    screenshots: false,
    tab_consent: true,
  };
}
async function register() {
  const s = await state();
  if (!s.token) return;
  await api('/register', { method: 'POST', body: {
    node_id: s.nodeId, device_name: `Chrome ${navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || ''}`,
    worker_version: chrome.runtime.getManifest().version, browser_version: navigator.userAgent,
    driver_mode: DRIVER_MODE, protocol_version: PROTOCOL_VERSION, capabilities: capabilities(),
  }});
  await storageSet({ online: true });
}
async function attachAllowed(tabId) {
  const s = await state();
  if (!s.allowedTabs[String(tabId)]) throw Object.assign(new Error('Tab is not allowed'), { code: 'TAB_NOT_ALLOWED' });
  try { await chrome.debugger.attach({ tabId }, '1.3'); }
  catch (error) {
    if (!/already attached/i.test(error.message)) throw Object.assign(error, { code: 'DEBUGGER_DETACHED' });
  }
}
async function detach(tabId) {
  try { await chrome.debugger.detach({ tabId }); } catch { /* already detached */ }
}
async function taskTab(args = {}) {
  const s = await state();
  const taskId = String(args.task_id || '').trim();
  const pinned = taskId ? Number(s.taskTabs[taskId] || 0) : 0;
  if (pinned && s.allowedTabs[String(pinned)]?.allowed) return pinned;
  const requested = Number(args.tab_id || args.tabId || 0);
  if (requested && s.allowedTabs[String(requested)]?.allowed) {
    if (taskId) { s.taskTabs[taskId] = requested; await storageSet({ taskTabs: s.taskTabs }); }
    return requested;
  }
  const allowedIds = Object.keys(s.allowedTabs).filter((id) => s.allowedTabs[id]?.allowed).map(Number);
  if (!allowedIds.length) throw Object.assign(new Error('Allow a Chrome tab from the Flolah extension first'), { code: 'TAB_NOT_ALLOWED' });
  const selected = allowedIds[0];
  if (taskId) { s.taskTabs[taskId] = selected; await storageSet({ taskTabs: s.taskTabs }); }
  return selected;
}
async function evaluate(tabId, expression) {
  const out = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true, userGesture: true,
  });
  if (out.exceptionDetails) throw new Error(out.exceptionDetails.text || 'Evaluation failed');
  return out.result?.value;
}
function snapshotExpression(limit) {
  return `(() => {
    const max=${Math.max(20, Math.min(1000, Number(limit) / 30 || 400))};
    const s=globalThis.__flolahSnapshotState||{href:'',generation:0,counter:0};
    if(s.href!==location.href){s.href=location.href;s.generation++;s.counter=0} globalThis.__flolahSnapshotState=s;
    const q='a[href],button,input,textarea,select,[contenteditable="true"],[role="button"],[role="link"],[role="textbox"],[role="menuitem"],[tabindex]';
    const elements=[];
    for(const el of document.querySelectorAll(q)){if(elements.length>=max)break;const r=el.getBoundingClientRect(),cs=getComputedStyle(el);if(r.width<=0||r.height<=0||cs.display==='none'||cs.visibility==='hidden')continue;let id=el.getAttribute('data-flolah-ref');if(!id){id=String(++s.counter);el.setAttribute('data-flolah-ref',id)}const type=String(el.getAttribute('type')||'').toLowerCase();elements.push({ref:'g'+s.generation+'-e'+id,role:el.getAttribute('role')||({A:'link',BUTTON:'button',INPUT:'textbox',TEXTAREA:'textbox',SELECT:'combobox'}[el.tagName]||el.tagName.toLowerCase()),name:String(el.getAttribute('aria-label')||el.innerText||el.getAttribute('placeholder')||el.getAttribute('name')||'').trim().slice(0,180),enabled:!el.disabled,visible:true,editable:el.matches('input,textarea,[contenteditable="true"]'),sensitive:type==='password'||/password|secret|token|card number|cvv/i.test(String(el.getAttribute('aria-label')||el.getAttribute('name')||'')),focused:document.activeElement===el,bounds:{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}})}
    return {protocol_version:1,page:{url:location.href,title:document.title,navigation_generation:s.generation},elements};
  })()`;
}
async function snapshot(tabId, limit = 12000) {
  const structured = await evaluate(tabId, snapshotExpression(limit));
  const text = `URL: ${structured.page.url}\nTitle: ${structured.page.title}\n\n` + structured.elements.map((e) => `- ${e.role} "${e.name}" [ref=${e.ref}]${e.enabled ? '' : ' [disabled]'}`).join('\n');
  return { ok: true, text: text.slice(0, limit), snapshot: text.slice(0, limit), structured_snapshot: structured };
}
async function act(tabId, request) {
  const kind = String(request.kind || request.action || '').toLowerCase();
  const ref = String(request.ref || '');
  const refMatch = /^g(\d+)-e(.+)$/.exec(ref);
  const local = refMatch?.[2] || '';
  const generation = Number(refMatch?.[1] || 0);
  const target = local ? `((Number(globalThis.__flolahSnapshotState?.generation||0)===${generation})?document.querySelector('[data-flolah-ref="${local.replace(/"/g, '')}"]'):'STALE_REF')` : 'null';
  if (kind === 'click') {
    const result = await evaluate(tabId, `(() => { const el=${target}; if(el==='STALE_REF')return {error:'STALE_REF'}; if(!el) return {error:'TARGET_NOT_FOUND'}; el.click(); return {clicked:true}; })()`);
    if (result?.error) throw Object.assign(new Error('Target not found'), { code: result.error });
    return { ok: true, kind };
  }
  if (kind === 'type') {
    const text = JSON.stringify(String(request.text ?? ''));
    const result = await evaluate(tabId, `(() => { const el=${target}; if(el==='STALE_REF')return {error:'STALE_REF'}; if(!el) return {error:'TARGET_NOT_FOUND'}; el.focus(); const v=${text}; if('value' in el){const set=Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')?.set; set?set.call(el,v):(el.value=v)}else el.textContent=v; el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:v})); el.dispatchEvent(new Event('change',{bubbles:true})); return {typed:true}; })()`);
    if (result?.error) throw Object.assign(new Error('Target not found'), { code: result.error });
    return { ok: true, kind, length: String(request.text ?? '').length };
  }
  if (kind === 'press') {
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyDown', key: request.key || 'Enter' });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', key: request.key || 'Enter' });
    return { ok: true, kind };
  }
  if (kind === 'scroll') {
    await evaluate(tabId, `scrollBy(0, ${String(request.direction || 'down').toLowerCase() === 'up' ? -800 : 800})`);
    return { ok: true, kind };
  }
  throw Object.assign(new Error(`Unsupported action: ${kind}`), { code: 'CAPABILITY_UNAVAILABLE' });
}
async function runAction(action, args = {}) {
  const tabId = await taskTab(args);
  await attachAllowed(tabId);
  const name = String(action || '').toLowerCase();
  if (name === 'status') return { ok: true, tab_id: tabId, driver: DRIVER_MODE };
  if (name === 'open') {
    const url = String(args.url || args.targetUrl || '');
    if (!/^https?:\/\//i.test(url)) throw Object.assign(new Error('Only HTTP(S) URLs are supported'), { code: 'POLICY_BLOCKED' });
    await chrome.tabs.update(tabId, { url });
    const deadline = Date.now() + 30000;
    let current = await chrome.tabs.get(tabId);
    while (current.status !== 'complete' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      current = await chrome.tabs.get(tabId);
    }
    return { ok: true, tab_id: tabId, url: current.url || url, title: current.title || '', result_state: 'action_applied' };
  }
  if (name === 'snapshot') return snapshot(tabId, Number(args.limit) || 12000);
  if (name === 'act') return act(tabId, args.request || args);
  if (name === 'wait') { await new Promise((resolve) => setTimeout(resolve, Math.min(30000, Number(args.ms || 1500)))); return { ok: true }; }
  if (name === 'action_batch' || name === 'batch') {
    const results = [];
    for (const item of (args.actions || []).slice(0, 20)) {
      try { results.push({ ok: true, result: await act(tabId, item) }); }
      catch (error) { results.push({ ok: false, error: error.message, failure_code: error.code || 'ACTION_FAILED' }); if (args.stop_on_failure !== false) break; }
    }
    return { ok: results.every((item) => item.ok), results, result_state: 'action_applied', structured_snapshot: args.return_snapshot ? (await snapshot(tabId)).structured_snapshot : null };
  }
  throw Object.assign(new Error(`Unsupported action: ${name}`), { code: 'CAPABILITY_UNAVAILABLE' });
}
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const s = await state();
    if (!s.token) return;
    const query = `?wait_ms=25000&node_id=${encodeURIComponent(s.nodeId)}&driver_mode=${DRIVER_MODE}&protocol_version=${PROTOCOL_VERSION}&worker_version=${chrome.runtime.getManifest().version}`;
    const pulled = await api(`/jobs${query}`);
    const job = pulled.job;
    if (!job) return;
    try {
      const result = await runAction(job.action, job.args || {});
      await api(`/jobs/${encodeURIComponent(job.id)}/result`, { method: 'POST', body: { ok: true, node_id: s.nodeId, result, result_state: result.result_state || 'outcome_verified' } });
    } catch (error) {
      await api(`/jobs/${encodeURIComponent(job.id)}/result`, { method: 'POST', body: { ok: false, node_id: s.nodeId, error: error.message, failure_code: error.code || 'ACTION_FAILED', result_state: 'outcome_not_observed' } });
    }
  } catch { await storageSet({ online: false }); }
  finally { polling = false; setTimeout(poll, 250); }
}
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  (async () => {
    if (message.type === 'status') {
      const s = await state(); const tab = await activeTab();
      return { paired: Boolean(s.token), online: Boolean(s.online), allowed: Boolean(tab && s.allowedTabs[String(tab.id)]?.allowed), tab };
    }
    if (message.type === 'pair') {
      const baseUrl = String(message.baseUrl || '').replace(/\/$/, '');
      await storageSet({ baseUrl });
      const result = await api('/pair', { method: 'POST', auth: false, body: { code: message.code, device_name: 'Flolah Chrome extension' } });
      await storageSet({ token: result.token, online: false }); await register(); poll(); return { ok: true };
    }
    if (message.type === 'allow_active_tab') {
      const s = await state(); const tab = await activeTab(); if (!tab) throw new Error('No active tab');
      s.allowedTabs[String(tab.id)] = { allowed: true, origin: new URL(tab.url).origin, allowed_at: new Date().toISOString() };
      await storageSet({ allowedTabs: s.allowedTabs }); await attachAllowed(tab.id); return { ok: true };
    }
    if (message.type === 'pause_active_tab') {
      const s = await state(); const tab = await activeTab(); if (tab) { delete s.allowedTabs[String(tab.id)]; await detach(tab.id); }
      for (const [taskId, id] of Object.entries(s.taskTabs)) if (Number(id) === tab.id) delete s.taskTabs[taskId];
      await storageSet({ allowedTabs: s.allowedTabs, taskTabs: s.taskTabs }); return { ok: true };
    }
    if (message.type === 'stop_all') {
      const s = await state(); for (const id of Object.keys(s.allowedTabs)) await detach(Number(id));
      await storageSet({ allowedTabs: {}, taskTabs: {} }); return { ok: true };
    }
    if (message.type === 'unpair') {
      const s = await state(); for (const id of Object.keys(s.allowedTabs)) await detach(Number(id));
      await chrome.storage.local.clear(); return { ok: true };
    }
    return { ok: false, error: 'Unknown request' };
  })().then(respond).catch((error) => respond({ ok: false, error: error.message }));
  return true;
});
chrome.tabs.onRemoved.addListener(async (tabId) => { const s = await state(); if (s.allowedTabs[String(tabId)]) delete s.allowedTabs[String(tabId)]; for (const [taskId, id] of Object.entries(s.taskTabs)) if (Number(id) === tabId) delete s.taskTabs[taskId]; await storageSet({ allowedTabs: s.allowedTabs, taskTabs: s.taskTabs }); });
chrome.debugger.onDetach.addListener(async ({ tabId }) => { const s = await state(); if (s.allowedTabs[String(tabId)]) { delete s.allowedTabs[String(tabId)]; await storageSet({ allowedTabs: s.allowedTabs }); } });
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 }));
chrome.runtime.onStartup.addListener(async () => { await register().catch(() => {}); poll(); });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === POLL_ALARM) poll(); });
register().then(poll).catch(() => {});
