export async function readModelResponse(response, unavailable) {
  let payload; try { payload = await response.json(); } catch { throw new Error(unavailable); }
  if (!response.ok) {
    if (['COPILOT_CHECKER_UNAVAILABLE', 'COPILOT_REVIEW_FAILED'].includes(payload?.code)) throw Object.assign(new Error('Copilot review unavailable'), { publicCode: payload.code });
    throw new Error(unavailable);
  }
  return payload;
}
