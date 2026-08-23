const statusEl = document.querySelector('#status');
const pairingEl = document.querySelector('#pairing');
const controlsEl = document.querySelector('#controls');
const tabLabel = document.querySelector('#tabLabel');

async function send(type, data = {}) {
  return chrome.runtime.sendMessage({ type, ...data });
}
async function refresh() {
  const state = await send('status');
  pairingEl.hidden = Boolean(state.paired);
  controlsEl.hidden = !state.paired;
  statusEl.textContent = state.paired
    ? `${state.online ? 'Online' : 'Connecting'} · ${state.allowed ? 'this tab is allowed' : 'this tab is not allowed'}`
    : 'Not paired';
  tabLabel.textContent = state.tab?.title || state.tab?.url || 'No active tab';
  document.querySelector('#allow').disabled = Boolean(state.allowed);
  document.querySelector('#pause').disabled = !state.allowed;
}
document.querySelector('#pair').addEventListener('click', async () => {
  statusEl.textContent = 'Pairing…';
  const result = await send('pair', {
    baseUrl: document.querySelector('#baseUrl').value,
    code: document.querySelector('#code').value,
  });
  statusEl.textContent = result.ok ? 'Paired' : (result.error || 'Pairing failed');
  await refresh();
});
document.querySelector('#allow').addEventListener('click', async () => { await send('allow_active_tab'); await refresh(); });
document.querySelector('#pause').addEventListener('click', async () => { await send('pause_active_tab'); await refresh(); });
document.querySelector('#stop').addEventListener('click', async () => { await send('stop_all'); await refresh(); });
document.querySelector('#unpair').addEventListener('click', async () => { await send('unpair'); await refresh(); });
refresh();
