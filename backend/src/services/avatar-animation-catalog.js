/**
 * Classify avatar GLB clip catalogs and sanitize speak/idle plans.
 * Mouth/lip clips must not be used as ambient idle loops.
 */

export function catalogClipNames(catalog = []) {
  return (Array.isArray(catalog) ? catalog : [])
    .map((c) => (typeof c === 'string' ? c : c?.name))
    .map((n) => String(n || '').trim())
    .filter(Boolean);
}

export function isMouthOrLipClip(name) {
  return /mouth|lip|viseme|jaw|phoneme/i.test(String(name || ''));
}

export function isIdleLikeClip(name) {
  return /^(idle|blink|breathe|breathing|look[_ -]?around|stand|rest)$/i.test(String(name || '').trim())
    || /idle|blink|breathe|look[_ -]?around/i.test(String(name || ''));
}

export function classifyAnimationCatalog(catalog = []) {
  const names = catalogClipNames(catalog);
  const mouth = names.find((n) => isMouthOrLipClip(n)) || null;
  const idle =
    names.find((n) => isIdleLikeClip(n) && n !== mouth) ||
    names.find((n) => !isMouthOrLipClip(n)) ||
    null;
  const gestures = names.filter((n) => n !== mouth && n !== idle);
  return { names, mouth, idle, gestures };
}

/**
 * Build a safe default plan when Brain output is missing/invalid.
 */
export function buildDefaultAnimationPlan(catalog = [], replyText = '') {
  const { mouth, idle, gestures } = classifyAnimationCatalog(catalog);
  const text = String(replyText || '').trim();
  const findGesture = (pattern) => gestures.find((name) => pattern.test(name)) || null;
  // A missing/malformed planner result should degrade to a neutral idle, not
  // the first catalog entry. Select expressive clips only when the reply makes
  // that action appropriate; potentially alarming clips require explicit text.
  let gesture = null;
  if (/\b(?:congrat|celebrat|applause|clap|well done|achievement)\b/i.test(text)) {
    gesture = findGesture(/clap|cheer|celebrat/i) || findGesture(/jump/i);
  } else if (/\b(?:jump|leap)\b/i.test(text)) {
    gesture = findGesture(/jump/i);
  } else if (/\b(?:run|sprint|hurry|race)\b/i.test(text)) {
    gesture = findGesture(/run/i);
  } else if (/\b(?:walk|stroll|move forward)\b/i.test(text)) {
    gesture = findGesture(/walk/i);
  } else if (/\b(?:sit|seated|take a seat)\b/i.test(text)) {
    gesture = findGesture(/sit/i);
  } else if (/\b(?:stand|ready|attention)\b/i.test(text)) {
    gesture = findGesture(/stand/i);
  } else if (/\b(?:sword|slash)\b/i.test(text)) {
    gesture = findGesture(/sword|slash/i);
  } else if (/\b(?:punch|fight)\b/i.test(text)) {
    gesture = findGesture(/punch|fight/i);
  } else if (/\b(?:death|dead|die|collapse)\b/i.test(text)) {
    gesture = findGesture(/death|die|collapse/i);
  }
  if (!gesture && text) {
    gesture = findGesture(/stand|talk|speak|gesture|nod|look/i);
  }
  const durationSec = Math.max(1.2, Math.min(12, text.length / 13 || 2));
  const visemes = mouth ? synthesizeMouthVisemes(mouth, durationSec, text) : [];
  return {
    clips: gesture
      ? [{ name: gesture, weight: 1, loop: false, timeScale: 1 }]
      : [],
    idle: idle || null,
    mouthClip: mouth || null,
    visemes,
    lookAt: null,
    sceneOutputs: [],
  };
}

/** Rough open/close envelope for Mouth_* clips while TTS plays. */
export function synthesizeMouthVisemes(mouthClipName, durationSec, text = '') {
  const mouth = String(mouthClipName || '').trim();
  if (!mouth) return [];
  const dur = Math.max(0.8, Number(durationSec) || 2);
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const beats = Math.max(4, Math.min(24, words.length * 2 || Math.ceil(dur * 3)));
  const out = [{ t: 0, name: mouth, weight: 0 }];
  for (let i = 0; i < beats; i += 1) {
    const t = (dur * (i + 1)) / (beats + 1);
    const open = i % 2 === 0 ? 0.85 : 0.15;
    out.push({ t: Number(t.toFixed(3)), name: mouth, weight: open });
  }
  out.push({ t: Number(dur.toFixed(3)), name: mouth, weight: 0 });
  return out;
}

/**
 * Ensure mouth clips are not ambient idle; move mouth loops into visemes.
 */
export function sanitizeAnimationPlan(raw, catalog = [], replyText = '', opts = {}) {
  const classified = classifyAnimationCatalog(catalog);
  const preferredIdle = opts.preferredIdle || null;
  const base = raw && typeof raw === 'object' ? raw : {};
  const clipsIn = Array.isArray(base.clips) ? base.clips : [];
  const clips = [];
  let mouthFromClips = null;
  for (const c of clipsIn) {
    const name = typeof c === 'string' ? c : c?.name;
    if (!name) continue;
    if (isMouthOrLipClip(name)) {
      mouthFromClips = name;
      continue;
    }
    clips.push(
      typeof c === 'string'
        ? { name: c, weight: 1, loop: false, timeScale: 1 }
        : {
            name: String(c.name).trim(),
            weight: c.weight != null ? Number(c.weight) : 1,
            loop: !!c.loop,
            timeScale: c.timeScale != null ? Number(c.timeScale) : 1,
          }
    );
  }
  let idle = preferredIdle || (base.idle != null ? String(base.idle) : classified.idle);
  if (idle && isMouthOrLipClip(idle)) idle = preferredIdle || classified.idle;
  if (!idle) idle = preferredIdle || classified.idle;
  const names = classified.names;
  if (idle && names.length && !names.includes(idle)) idle = preferredIdle && names.includes(preferredIdle) ? preferredIdle : classified.idle;

  const mouthClip =
    String(base.mouthClip || mouthFromClips || classified.mouth || '').trim() || null;

  let visemes = Array.isArray(base.visemes) ? base.visemes : [];
  visemes = visemes
    .map((v) => ({
      t: Number(v.t ?? v.time ?? 0),
      name: String(v.name || v.viseme || mouthClip || '').trim(),
      weight: v.weight != null ? Number(v.weight) : undefined,
    }))
    .filter((v) => v.name);

  if (mouthClip && (!visemes.length || visemes.length < 4)) {
    const lastT = visemes.reduce((m, v) => Math.max(m, Number(v.t) || 0), 0);
    const dur = Math.max(
      lastT,
      1.2,
      Math.min(12, String(replyText || '').length / 13 || 2)
    );
    visemes = synthesizeMouthVisemes(mouthClip, dur, replyText);
  }

  if (!clips.length) {
    clips.push(...buildDefaultAnimationPlan(catalog, replyText).clips);
  }

  return {
    clips,
    idle: idle || null,
    mouthClip,
    visemes,
    lookAt: base.lookAt ?? null,
    sceneOutputs: Array.isArray(base.sceneOutputs)
      ? base.sceneOutputs.filter((o) => o && typeof o === 'object')
      : [],
  };
}

export function buildAnimationPlannerPrompt(catalog = []) {
  const { names, mouth, idle, gestures } = classifyAnimationCatalog(catalog);
  return `You plan 3D avatar animation for Virtual Room speech.
Available clip names (use ONLY these exact names):
${JSON.stringify(names)}

Classified:
- mouth/lip clip (for lip-sync visemes only, NEVER as idle loop): ${mouth || '(none)'}
- preferred idle: ${idle || '(none)'}
- gesture clips: ${JSON.stringify(gestures)}

Return ONLY valid JSON (no markdown):
{"clips":[{"name":"<gesture clip>","weight":1,"loop":false,"timeScale":1}],"idle":"<idle clip>","mouthClip":"${mouth || ''}","visemes":[{"t":0,"name":"${mouth || 'Mouth_Open_Close'}","weight":0},{"t":0.12,"name":"${mouth || 'Mouth_Open_Close'}","weight":0.9}],"lookAt":null,"sceneOutputs":[]}

Rules:
1. idle must NOT be a mouth/lip clip. Prefer Blink / Look_Around / Idle.
2. clips = body gestures matching the actual reply intent. Do NOT put mouth clips or the idle clip in clips.
   - Use Clapping only for explicit applause, congratulations, celebration, or achievement—not ordinary greetings or friendly speech.
   - Use Jump, Run, Walk, Sitting, Punch, SwordSlash, or Death only when the reply explicitly calls for that action.
   - Every non-empty spoken reply should get one safe, visible, non-looping body clip when the catalog permits it.
   - For neutral speech or greetings without a more specific safe gesture, prefer Standing / Talk / Nod; never use Clapping as the generic fallback.
   - Body gestures must be short and non-looping; never loop Clapping or other action clips.
3. visemes = timed mouth open weights while speaking (t in seconds from speech start, weight 0..1). Use mouthClip name.
4. Estimate ~13 characters per second of speech from the reply text length.
5. If catalog empty: {"clips":[],"idle":null,"mouthClip":null,"visemes":[],"lookAt":null,"sceneOutputs":[]}
6. sceneOutputs (optional): route known agent/media outputs into Virtual Room media slots. Do NOT invent media.
   Format: [{"slotId":"<from media_slots>","kind":"video|chart|graph|image","from":"agent|mediaRef","payload":{}}]
   For chart/graph, payload may include { "chart": <chart-spec or {title,values[]}> } only when the agent reply clearly contains chart-like JSON.
   If workflow vars media_slots is empty or no matching outputs: use [].`;
}
