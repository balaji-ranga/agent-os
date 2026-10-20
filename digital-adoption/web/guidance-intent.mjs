// Shared, website-independent intent hints. These never authorize host effects.
// Route contextual language to interpretation, not literal field matching.
export const contextualReference=text=>/\b(?:previous|last|recent|earlier|above|those|them|these|that|it|just|you|changed|filled|prepared|proposed|reviewed)\b/i.test(String(text));
const noise=new Set('where is are can i find looking look for show me the a an please field fields input inputs box control controls on this page point to highlight locate at do does it go set change update fill enter and also too that there provider card cards result results item items'.split(' '));
export const guidanceWords=text=>(String(text).normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]).filter(word=>!noise.has(word));
export const barePointing=text=>/^\s*(?:please\s+)?(?:show\s+(?:me\s+)?where|point\s+(?:me\s+)?(?:to\s+)?(?:it|that)|highlight\s+(?:it|that))(?:\s+(?:also|too|please|it|is|that|there))*[.!?]*\s*$/i.test(String(text));
export const locating=text=>/^\s*(?:please\s+)?(?:where\s+(?:is|are|can\s+i\s+find)\b|show\s+(?:me\s+)?(?:where\b|(?:the\s+)?[^.!?]+\b(?:field|input|box|control|card|result|item)s?\b)|(?:highlight|locate|point\s+(?:me\s+)?to)\b)/i.test(String(text));
export const contentLookup=text=>{
 const request=String(text).replace(/\b(?:do not|don't|never)\s+(?:fill|change|set|select|save|submit)\b[^.!;]*/gi,'');
 return !/\b(?:field|input|box|control|fill|set|change|update|edit|select|choose|save|submit)\b/i.test(request)&&(/\b(?:looking\s+for|look\s+for)\b/i.test(request)||/^\s*(?:please\s+)?(?:find|search\s+for)\b/i.test(request)||/\b(?:show|locate|highlight|point|where)\b[\s\S]*\b(?:card|result|item)\b/i.test(request));
};
