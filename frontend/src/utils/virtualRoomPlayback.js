export function ttsPlaybackFromSteps(steps = [], avatarId = null, animationCatalog = []) {
  const list = Array.isArray(steps) ? steps : [];
  const step = list.find(
    (candidate) => candidate?.node_type === 'elevenlabs' && candidate?.status === 'completed'
  );
  const output = step?.output || {};
  const audio = output.audio || output.result?.audio || null;
  const audioUrl = audio?.url || audio?.download_url || null;
  if (!audioUrl) return null;
  const names = (Array.isArray(animationCatalog) ? animationCatalog : [])
    .map((item) => (typeof item === 'string' ? item : item?.name))
    .map((name) => String(name || '').trim())
    .filter(Boolean);
  const isMouth = (name) => /mouth|lip|viseme|jaw|phoneme/i.test(name);
  const idle =
    names.find((name) => /idle|blink|breathe|look[_ -]?around|stand|rest/i.test(name) && !isMouth(name)) ||
    names.find((name) => !isMouth(name)) ||
    null;
  return {
    avatarId,
    audioUrl,
    audioArtifactId: audio.artifactId || audio.artifact_id || null,
    animationCatalog: names,
    // This path exists only to start speech promptly. Gesture selection belongs
    // to the completed animation planner; guessing here made the first matching
    // positive clip (often Clapping) run for nearly every friendly response.
    animations: [],
    idle,
  };
}

export function animationOnlyPlayback(playback, audioAlreadyPlayed = false) {
  if (!playback || !audioAlreadyPlayed) return playback;
  return { ...playback, audioUrl: null };
}
