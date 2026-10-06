const unique = values => [...new Set(values.map(x => String(x || '').trim().toUpperCase()).filter(Boolean))];

// Keep exposure streams, then warmed qualified candidates, then new qualified
// candidates. Fill remaining slots stably; never silently raise the ceiling.
export function selectSubscriptionSymbols({ candidates, protectedSymbols = [], eligibleSymbols = [], previous = [], selectedAt = new Map(), cap = 40, now = Date.now(), minimumResidenceMs = 3600000 }) {
  const capacity = Math.floor(Number(cap));
  if (!(capacity > 0)) throw new Error('INVALID_SUBSCRIPTION_CAPACITY');
  const available = unique(candidates), protectedList = unique(protectedSymbols);
  if (protectedList.length > capacity) throw new Error('PROTECTED_SYMBOLS_EXCEED_SUBSCRIPTION_CAPACITY');
  const allowed = new Set(available), eligible = new Set(eligibleSymbols);
  const retained = unique(previous).filter(s => allowed.has(s));
  const resident = retained.filter(s => now - (selectedAt.get(s) ?? -Infinity) < minimumResidenceMs);
  return unique([...protectedList, ...retained.filter(s => eligible.has(s)), ...resident, ...available.filter(s => eligible.has(s)), ...retained, ...available]).slice(0, capacity);
}
