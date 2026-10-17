import { randomUUID, createHash } from 'node:crypto';

const deny = () => { throw new Error('Learning access denied or invalid data'); };
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const secret = value => /password|secret|token|credential|otp|cvv|credit.?card|api.?key|access.?key|private.?key/i.test(value);
function scopeKey(scope) {
  if (!identifier(scope?.embeddingId) || !identifier(scope?.audienceId)) deny();
  return `${scope.embeddingId}:${scope.audienceId}`;
}
function maintainer(scope) { scopeKey(scope); if (scope.role !== 'maintainer') deny(); }
function pathOf(value) {
  if (typeof value !== 'string' || value.length > 300 || !value.startsWith('/') || value.startsWith('//') || /[?#\\]/.test(value)) deny();
  if (decodeURIComponent(value).includes('..')) deny();
  return value;
}
function stepOf(step) {
  if (!step || !['navigate', 'fill', 'verify'].includes(step.action)) deny();
  // Typed semantic contract, not code or recorded private values.
  if (Object.keys(step).some(k => !['action', 'path', 'field', 'parameter', 'expectedPath','activation'].includes(k))) deny();
  const result = { action: step.action, path: pathOf(step.path) };
  if(step.activation!==undefined){if(step.action!=='navigate'||!['click','mousedown','pointerdown'].includes(step.activation))deny();result.activation=step.activation;}
  if (step.action === 'fill') {
    if (!identifier(step.field) || !identifier(step.parameter) || secret(step.field) || secret(step.parameter)) deny();
    result.field = step.field; result.parameter = step.parameter;
  }
  if (step.expectedPath !== undefined) result.expectedPath = pathOf(step.expectedPath);
  return result;
}

// All scope arguments are trusted control-plane authorization results, not request bodies.
export function createLearningStore(repository, { clock = Date.now } = {}) {
  const recipes = repository.map('recipes'), settings = repository.map('learning_settings'), imports=repository.map('learning_imports');
  const get = (scope, id) => {
    const recipe = recipes.get(id);
    if (!recipe || recipe.scope !== scopeKey(scope)) deny();
    return recipe;
  };
  const saveVersion = (recipe, data) => {
    const version = { ...data, version: recipe.versions.length + 1, updatedAt: clock() };
    recipe.versions.push(version); recipes.set(recipe.id, recipe);
    return structuredClone({ id: recipe.id, ...version });
  };
  const store = {
    learningEnabled(scope){return settings.get(scopeKey(scope))===true;},
    get(scope,id){const recipe=get(scope,id),current=recipe.versions.at(-1);if(scope.role!=='maintainer'&&current.status!=='published')deny();return structuredClone({id:recipe.id,...current});},
    setLearning(scope, enabled) {
      maintainer(scope); if (typeof enabled !== 'boolean') deny(); settings.set(scopeKey(scope), enabled);
    },
    create(scope, { title, steps, provenance = 'coached' }) {
      maintainer(scope);
      if (typeof title !== 'string' || !title.trim() || title.length > 120 || !Array.isArray(steps) || !steps.length || steps.length > 24 || !['coached','verified-session','imported'].includes(provenance)) deny();
      const recipe = { id: randomUUID(), scope: scopeKey(scope), versions: [] };
      return saveVersion(recipe, { title, steps: steps.map(stepOf), provenance, status: 'draft', validated: false });
    },
    learn(scope, { consent, verified, title, steps }) {
      maintainer(scope);
      if (settings.get(scopeKey(scope)) !== true || consent !== true || verified !== true) return { created: false };
      return { created: true, recipe: store.create(scope, { title, steps, provenance: 'verified-session' }) };
    },
    publish(scope, id, version, { reviewed, validated }) {
      maintainer(scope);
      return repository.transaction(() => {
        const recipe = get(scope,id), current = recipe.versions.at(-1);
        if (current.version !== version || reviewed !== true || validated !== true || current.status === 'disabled') deny();
        return saveVersion(recipe, { ...current, status: 'published', validated: true });
      });
    },
    disable(scope, id, version) {
      maintainer(scope);
      return repository.transaction(() => {
        const recipe = get(scope,id), current = recipe.versions.at(-1);
        if (current.version !== version) deny();
        return saveVersion(recipe, { ...current, status: 'disabled' });
      });
    },
    repair(scope, id, version, steps) {
      maintainer(scope);
      return repository.transaction(() => {
        const recipe = get(scope,id), current = recipe.versions.at(-1);
        if (current.version !== version || !Array.isArray(steps) || !steps.length || steps.length > 24) deny();
        return saveVersion(recipe, { ...current, steps: steps.map(stepOf), status: 'draft', validated: false });
      });
    },
    versions(scope,id) {
      maintainer(scope);return structuredClone(get(scope,id).versions);
    },
    rollback(scope,id,expectedVersion,targetVersion,{reviewed,validated}) {
      maintainer(scope);
      return repository.transaction(()=>{
        const recipe=get(scope,id),current=recipe.versions.at(-1),target=recipe.versions.find(v=>v.version===targetVersion);
        if(current.version!==expectedVersion||!target||target.status!=='published'||reviewed!==true||validated!==true)deny();
        // Append a version; never mutate historical approvals or assume that an
        // older version is still compatible with today's host page.
        return saveVersion(recipe,{...target,status:'published',validated:true,rollbackOf:target.version});
      });
    },
    list(scope) {
      const key = scopeKey(scope);
      return recipes.values({scope:key}).map(r => ({ id: r.id, ...r.versions.at(-1) }))
        .filter(r => scope.role === 'maintainer' || r.status === 'published').slice(0,100);
    },
    export(scope, id) {
      maintainer(scope); const current = get(scope,id).versions.at(-1);
      if (current.status !== 'published') deny();
      return { schema: 1, title: current.title, steps: structuredClone(current.steps) };
    },
    import(scope, bundle, {operationId} = {}) {
      maintainer(scope);
      if (bundle?.schema !== 1 || Object.keys(bundle).some(k => !['schema','title','steps'].includes(k))) deny();
      if(operationId!==undefined&&!identifier(operationId))deny();
      if(!operationId)return store.create(scope, { title: bundle.title, steps: bundle.steps, provenance: 'imported' });
      const key=`${scopeKey(scope)}:${operationId}`,fingerprint=createHash('sha256').update(JSON.stringify(bundle)).digest('hex');
      return repository.transaction(()=>{
        const previous=imports.get(key);
        if(previous){if(previous.fingerprint!==fingerprint)deny();return structuredClone(previous.result);}
        const result=store.create(scope,{title:bundle.title,steps:bundle.steps,provenance:'imported'});
        imports.set(key,{fingerprint,result});return result;
      });
    },
  };
  return store;
}
