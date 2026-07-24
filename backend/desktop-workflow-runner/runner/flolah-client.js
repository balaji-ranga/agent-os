export function createFlolahClient(params, log) {
  const base = String(params.desktop_api_base || '').replace(/\/$/, '');
  const token = params.desktop_token;

  async function request(method, path, body) {
    const url = `${base}${path}`;
    log.info(`${method} ${path}`);
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30 * 60 * 1000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Flolah ${method} ${path} failed (${res.status})`);
    }
    return data;
  }

  return {
    startRun: (input) => request('POST', '/runs', { input }),
    reportStep: (runId, payload) => request('POST', `/runs/${runId}/steps`, payload),
    executeNode: (runId, nodeId, context_patch) =>
      request('POST', `/runs/${runId}/execute-node`, { node_id: nodeId, context_patch }),
    complete: (runId, status, error_message) =>
      request('POST', `/runs/${runId}/complete`, { status, error_message }),
    getRun: (runId) => request('GET', `/runs/${runId}`),
  };
}
