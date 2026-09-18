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
  const reply = String(list.find((candidate) => candidate?.node_type === 'agent')?.output?.text || '');
  const positiveReply = /\b(?:hello|hi|welcome|thank|great|glad|congrat|delicious|happy)\b/i.test(reply);
  const gesture = positiveReply
    ? names.find((name) => /wave|clap|nod|greet/i.test(name) && name !== idle && !isMouth(name))
    : names.find((name) => /talk|speak|gesture|nod/i.test(name) && name !== idle && !isMouth(name));
  return {
    avatarId,
    audioUrl,
    audioArtifactId: audio.artifactId || audio.artifact_id || null,
    animationCatalog: names,
    animations: gesture ? [{ name: gesture, weight: 1, loop: false, timeScale: 1 }] : [],
    idle,
  };
}

export function animationOnlyPlayback(playback, audioAlreadyPlayed = false) {
  if (!playback || !audioAlreadyPlayed) return playback;
  return { ...playback, audioUrl: null };
}
