/** Preserve provider failures; a business error is not a transport negotiation. */
export function connectorExecutionError(status, payload = {}, retryAfter = null) {
  const message = String(payload.message || payload.error?.message ||
    (typeof payload.error === 'string' ? payload.error : '') || `OpenConnector request failed (${status})`);
  const providerCode = String(payload.errorCode || payload.code || payload.error?.code || '');
  // Some gateways map every provider 403 to authorization_failed. Quota is not OAuth.
  const quota = /quota|rate.?limit|too many requests|resource_exhausted/i.test(`${providerCode} ${message}`);
  const permanentQuota = quota && /per day|daily|billing|insufficient.quota/i.test(message);
  const code = permanentQuota ? 'quota_exceeded' : quota || status === 429 ? 'rate_limited' : providerCode || 'connector_request_failed';
  const numericRetry = Number(retryAfter);
  const retryMs = retryAfter == null ? 0 : Number.isFinite(numericRetry)
    ? Math.max(0, numericRetry * 1000) : Math.max(0, Date.parse(retryAfter) - Date.now()) || 0;
  return Object.assign(new Error(message), {
    status: code === 'rate_limited' ? 429 : status >= 400 ? status : 502,
    provider_status: status,
    provider_code: providerCode || undefined,
    code,
    retry_after_ms: retryMs || undefined,
  });
}

export function mayNegotiateMcp(error) {
  // Only an absent HTTP route may use the legacy transport. Never replay an
  // executed action (including writes) after timeout, quota, auth or validation.
  return [404, 405, 501].includes(error?.provider_status) &&
    (!error.provider_code || ['route_not_found', 'method_not_allowed', 'not_implemented'].includes(error.provider_code));
}

export async function invokeConnectorTransport(http, mcp) {
  try { return await http(); } catch (error) {
    if (!mayNegotiateMcp(error)) throw error;
    return mcp(error);
  }
}

export async function retryConnectorRead(invoke, { readOnly, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), retryDelayMs = 60000 } = {}) {
  try { return await invoke(); } catch (error) {
    if (!readOnly || error?.code !== 'rate_limited') throw error;
    const delay = Math.max(retryDelayMs, error.retry_after_ms || 0);
    // Don't ignore a longer provider deadline or loop for an unbounded duration.
    if (delay > 60000) throw error;
    await sleep(delay);
    return invoke();
  }
}

function messageData(out) {
  let data = out?.data ?? out;
  for (let i = 0; i < 4; i += 1) {
    if (Array.isArray(data?.messages)) return data;
    data = data?.data || data?.result;
  }
  throw connectorExecutionError(502, { code: 'invalid_provider_response', message: 'Connector did not return a messages page.' });
}

function replaceMessageData(out, data) {
  if (Array.isArray(out?.messages)) return { ...out, ...data };
  if (out?.data) return { ...out, data: replaceMessageData(out.data, data) };
  if (out?.result) return { ...out, result: replaceMessageData(out.result, data) };
  return out;
}

/** Page a connector read without changing its existing response envelope. */
export async function readConnectorMessagePages(input, executePage, pageSize = 25) {
  const limit = input.maxResults ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw connectorExecutionError(400, { code: 'invalid_input', message: 'maxResults must be an integer between 1 and 500.' });
  }
  let pageToken = input.pageToken;
  let last;
  let data;
  const messages = [];
  const seenTokens = new Set(pageToken ? [pageToken] : []);
  do {
    const pageInput = { ...input, maxResults: Math.min(pageSize, limit - messages.length) };
    if (pageToken) pageInput.pageToken = pageToken;
    last = await executePage(pageInput);
    data = messageData(last);
    messages.push(...data.messages);
    pageToken = data.nextPageToken;
    if (!pageToken || messages.length >= limit) break;
    if (seenTokens.has(pageToken)) throw connectorExecutionError(502, { code: 'invalid_provider_response', message: 'Connector repeated a pagination token.' });
    seenTokens.add(pageToken);
  } while (true);
  const result = replaceMessageData(last, { ...data, messages });
  if (typeof result.text === 'string') result.text = JSON.stringify(result.data);
  return result;
}
