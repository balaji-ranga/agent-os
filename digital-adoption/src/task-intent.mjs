// Interpret constraints before any model retry or deterministic fallback.
export function readOnlyIntent(text) {
  const value = String(text);
  const withoutProhibitions = value.replace(
    /\b(?:do not|don't|never)\s+(?:fill|populate|change|edit|set|select|check|uncheck|choose|clear|submit|save|navigate)(?:\s+or\s+(?:fill|select|check|submit|save|navigate))?\b[^.!;]*/gi,
    "",
  );
  const asksToWrite =
    /\b(?:fill|populate|set|change|update|edit|enter|select|check|uncheck|clear|choose|create|add|prepare)\b/i.test(
      withoutProhibitions,
    );
  return (
    !asksToWrite &&
    (/\b(?:summari[sz]e|explain|describe|inspect|list|show|what|which)\b/i.test(
      value,
    ) ||
      /\b(?:do not|don't|never)\s+(?:fill|populate|change|edit|set)\b/i.test(
        value,
      ))
  );
}
export function booleanIntent(text, field) {
  const name = String(field.label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `\\b(?:(do not|don't|never)\\s+)?(uncheck|deselect|untick|clear|disable|check|select|tick|enable)\\s+(?:the\\s+)?${name}(?=\\s*(?:[.,;!]|$|and\\b))`,
    "i",
  );
  const match = pattern.exec(String(text));
  return match && !match[1]
    ? String(!/^(?:uncheck|deselect|untick|clear|disable)$/i.test(match[2]))
    : null;
}
export function groundedValue(value, field, texts) {
  if (
    texts.some((text) =>
      String(text).toLowerCase().includes(String(value).toLowerCase()),
    )
  )
    return true;
  return (
    field?.type === "checkbox" &&
    texts.some(
      (text) =>
        booleanIntent(text, field) === value ||
        new RegExp(
          `${String(field.label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*${value === "true" ? "(?:yes|checked|selected|enabled)" : "(?:no|unchecked|unselected|disabled)"}\\b`,
          "i",
        ).test(text),
    )
  );
}
