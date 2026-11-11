import {convert} from 'html-to-text';

export function mailMessageText(message){
  const raw=message.messageTimestamp;
  const at=/^\d+$/.test(String(raw))?Number(raw):Date.parse(raw);
  const timestamp=Number.isFinite(at)?new Date(at).toISOString():'unknown (do not infer relative expiry)';
  const labels=Array.isArray(message.labelIds)?message.labelIds.map(String).join(', '):'not supplied';
  return `Message timestamp: ${timestamp}\nProvider labels: ${labels}\nSubject: ${message.subject||''}\n${sourceTextProjection(message.messageText)}`;
}

/** Presentation-only projection. Never summarize, clip a source or drop messages. */
export function sourceTextProjection(value){
  const raw=String(value??'');
  // Plain text can contain comparisons or an email address in angle brackets.
  if(!/<(?:!doctype\s+html|html\b|body\b|table\b|div\b|p(?:\s|>)|style\b)/i.test(raw))return raw;
  if(raw.length>1000000)return raw;
  const overflow='[FLOLAH_HTML_PROJECTION_LIMIT]';
  try {
    const text=convert(raw,{wordwrap:false,limits:{maxInputLength:0,maxDepth:200,ellipsis:overflow},
      selectors:[{selector:'img',format:'imageAlt'}],
      formatters:{imageAlt:(element,walk,builder)=>{if(element.attribs?.alt)builder.addInline(element.attribs.alt);}},
    });
    // An incomplete parser traversal must never be called a complete source.
    return text.includes(overflow)||!text.trim()?raw:text;
  }catch{return raw;}
}
