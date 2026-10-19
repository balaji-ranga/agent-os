// Separate from website knowledge. Callers must authorize the live task before
// and after each async operation; search results never grant task membership.
const prefix = 'adoption-private-tasks-v1-';
const policyId = 'adoption-private-task-24h-v1';
const retentionMs = 24 * 60 * 60 * 1000;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const unavailable = () => Object.assign(new Error('Private document search unavailable'), { publicCode: 'PRIVATE_SEARCH_UNAVAILABLE' });

export function createPrivateTaskSearch({ request, clock = Date.now }) {
  let policyReady;
  const readyIndexes = new Map();
  const indexName = () => prefix + new Date(clock()).toISOString().slice(0, 13).replace(/[-T]/g, '');
  const policy = { description: 'Private transaction passages: delete hourly indexes after 24 hours; authorization ends separately.', default_state: 'retained', states: [
    { name: 'retained', actions: [], transitions: [{ state_name: 'delete', conditions: { min_index_age: '24h' } }] },
    { name: 'delete', actions: [{ delete: {} }], transitions: [] }
  ] };
  const checkPolicy = value => {
    const states = value?.policy?.states;
    const retained=states?.find(s=>s.name==='retained'),deleted=states?.find(s=>s.name==='delete');
    if (value?.policy?.default_state !== 'retained' || !Array.isArray(states) || states.length !== 2 ||
        retained?.actions?.length!==0 || retained?.transitions?.length!==1 ||
        retained.transitions[0].state_name!=='delete' || retained.transitions[0].conditions?.min_index_age!=='24h' ||
        deleted?.actions?.length!==1 || !deleted.actions[0].delete || deleted?.transitions?.length!==0) throw unavailable();
  };
  async function ensurePolicy() {
    try { checkPolicy(await request(`/_plugins/_ism/policies/${policyId}`, 'GET')); }
    catch (error) {
      if (error.statusCode !== 404) throw error;
      try { await request(`/_plugins/_ism/policies/${policyId}`, 'PUT', { policy }); }
      catch (createError) { if (createError.statusCode !== 409) throw createError; }
      checkPolicy(await request(`/_plugins/_ism/policies/${policyId}`, 'GET'));
    }
  }
  async function ensureIndex(index) {
    await (policyReady ||= ensurePolicy().catch(error => { policyReady = null; throw error; }));
    try { await request(`/${index}/_mapping`, 'GET'); }
    catch (error) {
      if (error.statusCode !== 404) throw error;
      try {
        await request(`/${index}`, 'PUT', { settings: { number_of_shards: 1, number_of_replicas: 0 }, mappings: {
          dynamic: 'strict', _meta: { privateTaskVersion: 1 }, properties: Object.fromEntries([
            ...['owner_id', 'task_id', 'embedding_id', 'uploader_id', 'file_id', 'attempt_id', 'reference', 'filename', 'locator'].map(key => [key, { type: 'keyword' }]),
            ['text', { type: 'text' }], ['expires_at', { type: 'date', format: 'epoch_millis' }]
          ])
        } });
      } catch (createError) { if (createError.statusCode !== 400) throw createError; await request(`/${index}/_mapping`, 'GET'); }
    }
    let explanation = await request(`/_plugins/_ism/explain/${index}`, 'GET');
    if (!explanation[index]?.policy_id) {
      await request(`/_plugins/_ism/add/${index}`, 'POST', { policy_id: policyId });
      explanation = await request(`/_plugins/_ism/explain/${index}`, 'GET');
    }
    // ISM add acknowledges before its managed-index metadata is visible on
    // every read. Wait a bounded interval; never publish unverified content.
    for(let attempt=0;!explanation[index]?.policy_id&&attempt<12;attempt++){
      await new Promise(resolve=>setTimeout(resolve,250));
      explanation=await request(`/_plugins/_ism/explain/${index}`,'GET');
    }
    if (explanation[index]?.policy_id !== policyId) throw unavailable();
  }
  async function provision() {
    const index = indexName();
    for (const key of readyIndexes.keys()) if (key !== index) readyIndexes.delete(key);
    await (readyIndexes.get(index) || (() => {
      const pending = ensureIndex(index).catch(error => { readyIndexes.delete(index); throw error; });
      readyIndexes.set(index, pending); return pending;
    })());
    return index;
  }
  function validateScope(scope) {
    if (![scope.ownerId, scope.taskId].every(validId)) throw unavailable();
  }
  return {
    provision,
    retentionHours: 24,
    async index({ ownerId, taskId, file, sections }) {
      validateScope({ ownerId, taskId });
      if (![file.id, file.embeddingId, file.uploaderId, file.attemptId].every(validId) || !Array.isArray(sections) ||
          !sections.length || sections.length > 300 || Buffer.byteLength(JSON.stringify(sections)) > 250000 ||
          sections.some(s => typeof s.text !== 'string' || typeof s.locator !== 'string' || s.locator.length > 300)) throw unavailable();
      const index = await provision(), expiresAt = clock() + retentionMs, documents = [];
      sections.forEach((section, sectionNumber) => {
        for (let offset = 0; offset < section.text.length; offset += 1600) {
          const reference = `${file.id}:${sectionNumber + 1}:${Math.floor(offset / 1600) + 1}`;
          documents.push({ owner_id: ownerId, task_id: taskId, embedding_id: file.embeddingId, uploader_id: file.uploaderId,
            file_id: file.id, attempt_id: file.attemptId, filename: file.filename, locator: section.locator,
            reference, text: section.text.slice(offset, offset + 1800), expires_at: expiresAt });
        }
      });
      if (documents.length > 1000) throw unavailable();
      if (documents.length) await request('/_bulk?refresh=wait_for', 'POST', documents.flatMap(doc => [
        JSON.stringify({ index: { _index: index, _id: `${taskId}:${file.attemptId}:${doc.reference}` } }), JSON.stringify(doc)
      ]).join('\n') + '\n', true);
      return { indexed: documents.length };
    },
    async search({ ownerId, taskId, files, query }) {
      validateScope({ ownerId, taskId });
      if (!Array.isArray(files) || files.length > 64 || files.some(file => ![file.id, file.embeddingId, file.uploaderId, file.attemptId].every(validId))) throw unavailable();
      if (!files.length) return [];
      const response = await request(`/${prefix}*/_search?allow_no_indices=true&ignore_unavailable=true`, 'POST', {
        size: 8, _source: ['file_id', 'filename', 'locator', 'text', 'reference', 'attempt_id', 'embedding_id', 'uploader_id', 'owner_id', 'task_id', 'expires_at'],
        sort: [{ _score: 'desc' }, { reference: 'asc' }], query: { bool: {
          filter: [{ term: { owner_id: ownerId } }, { term: { task_id: taskId } }, { range: { expires_at: { gt: clock() } } },
            { bool: { should: files.map(file => ({ bool: { filter: [
              { term: { file_id: file.id } }, { term: { embedding_id: file.embeddingId } },
              { term: { uploader_id: file.uploaderId } }, { term: { attempt_id: file.attemptId } }
            ] } })), minimum_should_match: 1 } }],
          ...(String(query || '').trim() ? { should: [{ match: { text: String(query).slice(0, 8000) } }] } : {})
        } }
      });
      if (!Array.isArray(response.hits?.hits)) throw unavailable();
      return response.hits.hits.slice(0, 8).map(hit => {
        const doc = hit._source;
        if (doc?.owner_id !== ownerId || doc?.task_id !== taskId || doc.expires_at <= clock() ||
            !files.some(f => f.id === doc.file_id && f.embeddingId === doc.embedding_id && f.uploaderId === doc.uploader_id && f.attemptId === doc.attempt_id) ||
            typeof doc.text !== 'string' || typeof doc.reference !== 'string' || typeof doc.filename !== 'string' || typeof doc.locator !== 'string') throw unavailable();
        return { attachmentId: doc.file_id, filename: doc.filename, locator: doc.locator, text: doc.text.slice(0, 1800), reference: doc.reference };
      });
    }
  };
}
