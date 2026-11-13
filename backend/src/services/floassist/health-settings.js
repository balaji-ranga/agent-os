export const CONNECTOR_HEALTH_JOB = 'floassist_connector_health';
export function connectorAlertCooldownMs(preferences={}) {
  const n=Number(preferences.connector_alert_cooldown_minutes??60);
  return (Number.isInteger(n)&&n>=15&&n<=1440?n:60)*60000;
}
export function connectorHealthEnabled(profile) {
  if (!profile || !['active', 'paused', 'stopped'].includes(profile.status)) return false;
  const prefs = profile.preferences || JSON.parse(profile.preferences_json || '{}');
  if (typeof prefs.connector_health_enabled === 'boolean') return prefs.connector_health_enabled;
  // Preserve existing installations until their owner chooses the independent setting.
  return profile.status === 'active' && !!prefs.responsibilities?.includes('priority');
}
