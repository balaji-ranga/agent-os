export function profileFieldStatus(item, field, rules = {}) {
  if (item.security_type === 'ETF') return 'Not required (ETF)';
  if (field === 'fundamentals_at' && rules.fundamentals?.enabled === false || field === 'corporate_events_at' && rules.corporate_events?.enabled === false || field === 'membership_at' && !(rules.indexes || []).length) return 'Not required';
  return item[field] ? null : 'Missing';
}
