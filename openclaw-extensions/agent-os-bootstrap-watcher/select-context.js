/** Fresh-source checks must not carry old mail/digests into every inference.
 * Keep policy, identity and user preferences; memory remains on disk for an
 * explicit read. This is per-run projection, not deletion or global truncation. */
export function selectBootstrapContext(files,scope,now=Date.now()) {
  if(scope?.context_mode!=='fresh_sources'||!(Date.parse(scope.expires_at)>now))return files;
  return files.map(file=>/^memory\.md$/i.test(file.name)&&!file.missing
    ? {...file,content:'Historical memory is retained in this workspace but is not preloaded for this fresh-source check. Use current source evidence and the supplied tracked-obligation snapshot. Read a specific stored fact only if needed; never treat an old digest as current source evidence.'}
    : file);
}
