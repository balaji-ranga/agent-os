export function profileTimezoneHint(profile){
 if(!profile?.enabled)return '';
 if(!profile.timezone_available||typeof profile.timezone!=='string')return 'The FloAssist profile timezone could not be loaded. Do not assume UTC or the server timezone. Read floassist_status or ask the owner before interpreting or confirming dates/times.';
 return `Trusted FloAssist profile timezone: ${profile.timezone}. Current owner-local date/time: ${profile.local_now}. No tool call is needed merely to look up the timezone when this fresh context is present. This profile timezone governs relative dates (today/tomorrow), reminders, calendar windows, email dates and all user-facing time confirmations; the gateway/server UTC clock is not the owner timezone. Convert source UTC timestamps into ${profile.timezone}; use explicit offsets for connector inputs. Display UTC only when the owner explicitly asks. Follow returned due_local/timezone values when available.`;
}
