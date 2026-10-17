// Narrow explicit partial edits to observed controls, never infer values here.
// Creation and ambiguous requests retain the full form for model reasoning.
export function constrainEdit(text, snapshot) {
  if (!/^\s*(set|change|update|edit)\b/i.test(text) || snapshot.navigationRequired) return snapshot;
  const normalized = String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const matching = snapshot.fields.filter(field => {
    const label = field.label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return label.length >= 3 && ` ${normalized} `.includes(` ${label} `);
  });
  if (!matching.length) return snapshot;
  return {...snapshot, fields:matching, links:[], partialEdit:true};
}
