export function semanticFieldKey(element,name=''){
 const declared=element.getAttribute?.('data-adoption-id')||element.name||element.id||'';
 if(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(declared))return declared;
 const readable=String(name).normalize('NFKC').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,60);
 if(readable)return `field_${readable}`;
 const encoded=[...String(name)].map(c=>c.codePointAt(0).toString(16)).join('_').slice(0,64);
 return encoded?`field_${encoded}`:null;
}
