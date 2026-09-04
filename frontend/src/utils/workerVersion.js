export function compareWorkerVersions(running, latest) {
  const parse = value => /^\d+\.\d+\.\d+$/.test(String(value || '')) ? String(value).split('.').map(Number) : null;
  const a = parse(running), b = parse(latest);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  return 0;
}
