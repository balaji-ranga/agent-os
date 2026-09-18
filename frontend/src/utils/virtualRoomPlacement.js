function numberOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pointPosition(point) {
  const value = point?.position ?? point;
  if (Array.isArray(value)) {
    return { x: numberOr(value[0]), y: numberOr(value[1]), z: numberOr(value[2]) };
  }
  if (value && typeof value === 'object') {
    return { x: numberOr(value.x), y: numberOr(value.y), z: numberOr(value.z) };
  }
  return null;
}

/** Resolve an explicit scene spawn by avatar/handle/id, then by member order. */
export function findSceneSpawn(sceneJson = {}, member = {}, index = 0) {
  const points = Array.isArray(sceneJson?.spawnPoints) ? sceneJson.spawnPoints : [];
  if (!points.length) return null;
  const avatarId = String(member.avatar_id || '').toLowerCase();
  const handle = String(member.handle || '').toLowerCase();
  const named = points.find((point) => {
    const keys = [point?.avatarId, point?.avatar_id, point?.handle, point?.id]
      .map((value) => String(value || '').toLowerCase())
      .filter(Boolean);
    return keys.includes(avatarId) || keys.includes(handle);
  });
  return pointPosition(named || points[index % points.length]);
}

/**
 * Resolve a visible member position. Legacy auto-layout positions were stored
 * on the environment origin, which can be inside imported scene geometry.
 * New/manual positions are preserved; otherwise an environment room receives
 * a camera-facing presentation row.
 */
export function resolveAvatarSpawn({ member = {}, index = 0, count = 1, sceneJson = {}, hasEnvironment = false } = {}) {
  const explicit = findSceneSpawn(sceneJson, member, index);
  if (explicit) return { ...explicit, source: 'scene' };

  const saved = member?.position && typeof member.position === 'object' ? member.position : null;
  const savedPosition = saved
    ? { x: numberOr(saved.x), y: numberOr(saved.y), z: numberOr(saved.z) }
    : null;
  const looksManuallyPlaced = saved?.manual === true || !hasEnvironment ||
    (savedPosition && (Math.abs(savedPosition.y) > 0.001 || Math.abs(savedPosition.z) > 0.001));
  if (savedPosition && looksManuallyPlaced) return { ...savedPosition, source: 'saved' };

  return {
    x: index * 1.4 - (Math.max(1, count) - 1) * 0.7,
    y: 0,
    z: hasEnvironment ? 2.2 : 0,
    source: hasEnvironment ? 'safe-scene-default' : 'stage-default',
  };
}

