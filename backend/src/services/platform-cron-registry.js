/**
 * Platform-level cron registry — pause / resume / ad-hoc trigger for Admin.
 * Persists paused flags and last-run timestamps in platform_settings so they survive process restart.
 */
import cron from 'node-cron';
import { getPlatformSetting, setPlatformSetting, ensurePlatformSettingsTable } from './platform-llm-settings.js';

const PAUSED_KEY = 'platform_cron_paused';
const LAST_RUN_KEY = 'platform_cron_last_run';
/** @type {Map<string, { id: string, name: string, description: string, schedule: string, envVar: string|null, enabled: boolean, task: import('node-cron').ScheduledTask|null, handler: () => Promise<any>|any, lastRunAt: string|null, lastResult: any, lastError: string|null, running: boolean }>} */
const jobs = new Map();

function readPausedSet() {
  ensurePlatformSettingsTable();
  try {
    const raw = getPlatformSetting(PAUSED_KEY, '{}');
    const parsed = JSON.parse(raw || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (_) {}
  return {};
}

function writePausedSet(map) {
  setPlatformSetting(PAUSED_KEY, JSON.stringify(map || {}));
}

function isPaused(id) {
  const map = readPausedSet();
  return !!map[String(id)];
}

/** @returns {Record<string, { at?: string, error?: string|null }>} */
function readLastRunMap() {
  ensurePlatformSettingsTable();
  try {
    const raw = getPlatformSetting(LAST_RUN_KEY, '{}');
    const parsed = JSON.parse(raw || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (_) {}
  return {};
}

function writeLastRunMap(map) {
  setPlatformSetting(LAST_RUN_KEY, JSON.stringify(map || {}));
}

function persistLastRun(id, { at, error }) {
  const map = readLastRunMap();
  map[String(id)] = {
    at: at || null,
    error: error ? String(error).slice(0, 2000) : null,
    updated_at: new Date().toISOString(),
  };
  writeLastRunMap(map);
}

function hydrateLastRun(entry) {
  const saved = readLastRunMap()[entry.id];
  if (!saved || typeof saved !== 'object') return;
  if (saved.at) entry.lastRunAt = String(saved.at);
  if (saved.error != null && saved.error !== '') entry.lastError = String(saved.error);
  else if (saved.at) entry.lastError = null;
}

/**
 * Register a platform cron job. Call once at startup (before listen).
 * @param {{ id: string, name: string, description: string, schedule: string, envVar?: string|null, handler: () => Promise<any>|any, enabled?: boolean }} opts
 */
export function registerPlatformCron(opts) {
  const id = String(opts.id || '').trim();
  if (!id) throw new Error('registerPlatformCron: id required');
  if (jobs.has(id)) {
    console.warn(`[platform-cron] replacing already-registered job ${id}`);
    try {
      jobs.get(id)?.task?.stop();
    } catch (_) {}
  }

  const kind = opts.kind === 'event' ? 'event' : 'timer';
  const schedule = String(opts.schedule || '').trim();
  const hasValidSchedule = !!schedule && cron.validate(schedule);
  const enabled =
    opts.enabled === false ? false : kind === 'event' ? true : hasValidSchedule;
  const entry = {
    id,
    name: opts.name || id,
    description: opts.description || '',
    schedule,
    envVar: opts.envVar || null,
    kind,
    eventWhen: opts.eventWhen || null,
    enabled,
    task: null,
    handler: opts.handler,
    lastRunAt: null,
    lastResult: null,
    lastError: null,
    running: false,
  };
  hydrateLastRun(entry);

  if (enabled && hasValidSchedule) {
    entry.task = cron.schedule(schedule, () => {
      if (isPaused(id)) {
        console.log(`[platform-cron] skipped (paused): ${id}`);
        return;
      }
      void runPlatformCron(id, { source: 'schedule' });
    });
    if (isPaused(id)) {
      try {
        entry.task.stop();
      } catch (_) {}
      console.log(`[platform-cron] registered paused: ${id} (${schedule}) kind=${kind}`);
    } else {
      console.log(`[platform-cron] registered: ${id} (${schedule}) kind=${kind}`);
    }
  } else if (enabled && kind === 'event') {
    console.log(
      `[platform-cron] registered event watcher: ${id}` +
        (opts.eventWhen ? ` when=${opts.eventWhen}` : '') +
        (isPaused(id) ? ' (paused)' : '')
    );
  } else {
    console.warn(
      `[platform-cron] not scheduled: ${id}` +
        (schedule ? ` (invalid/empty schedule "${schedule}")` : ' (disabled)')
    );
  }

  jobs.set(id, entry);
  return entry;
}

/** Admin kill-switch for event watchers (unregistered id => active / fail-open). */
export function isPlatformCronActive(id) {
  const key = String(id || '').trim();
  if (!key) return true;
  const entry = jobs.get(key);
  if (!entry) return true;
  if (!entry.enabled) return false;
  return !isPaused(entry.id);
}

export function isPlatformCronPaused(id) {
  return isPaused(String(id || '').trim());
}

export async function runPlatformCron(id, { source = 'manual' } = {}) {
  const entry = jobs.get(String(id));
  if (!entry) {
    const err = new Error(`Unknown platform cron: ${id}`);
    err.status = 404;
    throw err;
  }
  if (entry.running) {
    const err = new Error(`Cron ${id} is already running`);
    err.status = 409;
    throw err;
  }
  entry.running = true;
  const started = new Date().toISOString();
  console.log(`[platform-cron] run start id=${id} source=${source}`);
  try {
    const result = await entry.handler();
    entry.lastRunAt = started;
    entry.lastResult = result == null ? { ok: true } : result;
    entry.lastError = null;
    persistLastRun(id, { at: started, error: null });
    console.log(`[platform-cron] run ok id=${id} source=${source}`);
    return { ok: true, id, source, started_at: started, result: entry.lastResult };
  } catch (e) {
    entry.lastRunAt = started;
    entry.lastError = e?.message || String(e);
    entry.lastResult = null;
    persistLastRun(id, { at: started, error: entry.lastError });
    console.error(`[platform-cron] run failed id=${id}:`, entry.lastError);
    throw e;
  } finally {
    entry.running = false;
  }
}

export function pausePlatformCron(id) {
  const entry = jobs.get(String(id));
  if (!entry) {
    const err = new Error(`Unknown platform cron: ${id}`);
    err.status = 404;
    throw err;
  }
  const map = readPausedSet();
  map[entry.id] = true;
  writePausedSet(map);
  try {
    entry.task?.stop();
  } catch (_) {}
  console.log(`[platform-cron] paused ${entry.id}`);
  return describeJob(entry);
}

export function resumePlatformCron(id) {
  const entry = jobs.get(String(id));
  if (!entry) {
    const err = new Error(`Unknown platform cron: ${id}`);
    err.status = 404;
    throw err;
  }
  const map = readPausedSet();
  delete map[entry.id];
  writePausedSet(map);
  if (entry.enabled && entry.task) {
    try {
      entry.task.start();
    } catch (_) {}
  }
  console.log(`[platform-cron] resumed ${entry.id}`);
  return describeJob(entry);
}

function describeJob(entry) {
  const paused = isPaused(entry.id);
  const kind = entry.kind || 'timer';
  let status = 'running';
  if (!entry.enabled) status = 'disabled';
  else if (paused) status = 'paused';
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    schedule: entry.schedule,
    schedule_display:
      kind === 'event'
        ? entry.eventWhen
          ? 'event: ' + entry.eventWhen
          : 'event-driven'
        : entry.schedule || '—',
    kind,
    event_when: entry.eventWhen || null,
    env_var: entry.envVar,
    enabled: entry.enabled,
    paused,
    status,
    running_now: !!entry.running,
    last_run_at: entry.lastRunAt,
    last_error: entry.lastError,
    last_result: entry.lastResult,
  };
}

export function listPlatformCrons() {
  return [...jobs.values()].map(describeJob);
}

export function getPlatformCron(id) {
  const entry = jobs.get(String(id));
  return entry ? describeJob(entry) : null;
}