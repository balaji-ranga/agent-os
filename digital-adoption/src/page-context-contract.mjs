export function pageStructure(p,invalid,targets=[]) {
 if(p.title!==undefined&&(typeof p.title!=='string'||p.title.length>200))invalid();
 if(p.structureTruncated!==undefined&&typeof p.structureTruncated!=='boolean')invalid();
 if(p.structure!==undefined&&(!Array.isArray(p.structure)||p.structure.length>56||JSON.stringify(p.structure).length>9000||p.structure.some(e=>!e||typeof e.role!=='string'||!/^[a-z][a-z0-9-]{0,31}$/.test(e.role)||typeof e.label!=='string'||e.label.length>240||typeof e.region!=='string'||e.region.length>160||e.description!==undefined&&(typeof e.description!=='string'||e.description.length>240)||['disabled','required','expanded'].some(k=>e[k]!==undefined&&typeof e[k]!=='boolean')||e.current!==undefined&&(typeof e.current!=='string'||e.current.length>20))))invalid();
 for(const entry of p.structure||[])if(entry.targetRef!==undefined&&!targets.some(t=>t.ref===entry.targetRef&&t.role===entry.role&&t.label===entry.label.slice(0,160)))invalid();
 return {...(p.title!==undefined?{title:p.title}:{}),...(p.structure?{structure:p.structure.map(e=>Object.fromEntries(['role','label','region','description','disabled','required','expanded','current','targetRef'].filter(k=>e[k]!==undefined).map(k=>[k,e[k]]))),structureTruncated:p.structureTruncated===true}:{})};
}
