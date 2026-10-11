// Adapters enumerate membership, but load content only when its source version
// changed. A group includes derived passages: skipping a parent must not delete
// its children. No timestamp is invented when a provider exposes no version.
export async function* versionedSource(key, version, load, incremental) {
  if (!incremental) { yield* load(); return; }
  if (version != null && await incremental.reuse(key, version)) return;
  yield { knowledge_control: 'group_start', key };
  for await (const record of load()) yield { knowledge_control: 'group_record', key, record };
  yield { knowledge_control: 'group_end', key, version };
}
