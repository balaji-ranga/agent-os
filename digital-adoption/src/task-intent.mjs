import {resolveChoice,choiceText} from '../web/choice-intent.mjs';
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
    (/\b(?:summari[sz]e|explain|describe|inspect|list|show|what|which|recommend|suggest)\b/i.test(
      value,
    ) ||
      /\b(?:do not|don't|never)\s+(?:fill|populate|change|edit|set)\b/i.test(
        value,
      ))
  );
}
// Only an explicit user request authorizes fictional draft values. Document
// passages never call this helper as the request or grant execution authority.
export function syntheticDataIntent(text){
 if(typeof text!=='string'||readOnlyIntent(text)||/\b(?:do not|don't|never)\s+(?:use|generate|create|fill|enter|provide)\b[^.!;]*\b(?:dummy|synthetic|mock|sample|fictional)\b/i.test(text))return false;
 return /^\s*(?:(?:please|can you|could you|i want you to|i would like you to)\s+)?(?:fill|populate|generate|create|prepare|enter|use|provide)\b/i.test(text)&&/\b(?:dummy|synthetic|mock|sample|fictional)\s+(?:data|values?|details?|entries|records?)\b/i.test(text);
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
export function groundedValue(value, field, texts, {synthetic=false}={}) {
  if(synthetic&&field&&["text","textarea","email","tel","url","number","date","time","datetime-local","month","week","checkbox","select-one","radio"].includes(field.type)){if(field.choices)return field.choices.includes(value);if(field.type==="checkbox")return ["true","false"].includes(value);return typeof value==="string"&&value.length<=8000;}
  if (
    texts.some((text) =>
      String(text).toLowerCase().includes(String(value).toLowerCase()),
    )
  )
    return true;
  if(field?.choices&&['select-one','radio'].includes(field.type)&&typeof value==='string'&&value.length<=80){const target=choiceText(value),count=target.split(' ').length;for(const source of texts){const words=choiceText(String(source).slice(0,16000)).split(' ');for(let size=Math.max(1,count-1);size<=Math.min(5,count+1);size++)for(let i=0;i+size<=words.length;i++){const candidate=words.slice(i,i+size).join(' ');if(Math.abs(candidate.length-target.length)<=2&&resolveChoice(candidate,field.choices)===value)return true;}}}
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
