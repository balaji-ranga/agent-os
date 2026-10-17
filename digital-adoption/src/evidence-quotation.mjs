// Match source characters without allowing invented words or dropping normal
// word spaces. A PDF layout newline may split a word; retain the actual source
// span in the returned quotation rather than publishing the model's spelling.
export function copySupportingQuote(text,quote){
 if(typeof text!=='string'||typeof quote!=='string'||text.length>12_000||quote.length<12||quote.length>600)return null;
 const escape=character=>character.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const pattern=quote.trim().split(/(\s+)/u).map(part=>/^\s+$/u.test(part)?'\\s+':[...part].map(escape).join('(?:\\r?\\n)*')).join('');
 if(!pattern)return null;
 return new RegExp(pattern,'u').exec(text)?.[0]||null;
}
