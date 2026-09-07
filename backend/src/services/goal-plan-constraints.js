/** True when the original goal explicitly forbids a terminal notification. */
export function promptForbidsNotifyCeo(prompt) {
  const text = String(prompt || '');
  return (
    /\b(?:do not|don't|never|must not)\b[^.\n]{0,60}\bnotify[_\s-]?ceo\b/i.test(text) ||
    /\b(?:do not|don't|never|must not)\b[^.\n]{0,60}\b(?:send|issue|create|deliver)\s+(?:any\s+)?notifications?\b/i.test(text) ||
    /\b(?:no|without)\s+(?:external\s+)?notifications?\b/i.test(text)
  );
}
