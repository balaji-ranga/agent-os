// Add an opt-in script to HTML from one host's application proxy only.
export function withHostPreview(source,hostname,snippet){
 const blocks=[];let quote=null,comment=false,depth=0,start=-1;
 for(let i=0;i<source.length;i++){
  const c=source[i];if(comment){if(c==='\n')comment=false;continue;}if(quote){if(c==='\\'){i++;continue;}if(c===quote)quote=null;continue;}if(c==='#'){comment=true;continue;}if(c==='"'||c==="'"){quote=c;continue;}
  if(c==='{'){if(depth===0){const before=source.slice(Math.max(0,i-20),i);start=/\bserver\s*$/.test(before)?i:-1;}depth++;}
  if(c==='}'){depth--;if(depth===0&&start>=0){blocks.push({start,end:i+1,text:source.slice(start,i+1)});start=-1;}}
 }
 const selected=blocks.filter(block=>/\blisten\s+(?:\[::\]:)?443\b/.test(block.text)&&[...block.text.matchAll(/\bserver_name\s+([^;]+);/g)].some(match=>match[1].trim().split(/\s+/).includes(hostname)));
 if(selected.length!==1)throw new Error('Expected one exact HTTPS host block');
 const block=selected[0];let changed=0;
 const text=block.text.replace(/location\s+(\/|@[a-zA-Z0-9_-]+)\s*\{([^{}]*)\}/g,(whole,name,body)=>{
  if(!/\bproxy_pass\s+/.test(body))return whole;
  const cleaned=body.replace(/\s*# digital-adoption-preview[\s\S]*?# \/digital-adoption-preview\s*/g,'\n');
  if(/\bsub_filter\s+/.test(cleaned))throw new Error('Existing proxy filter needs explicit reconciliation');
  changed++;return `location ${name} {${cleaned}\n        # digital-adoption-preview\n        proxy_set_header Accept-Encoding "";\n        sub_filter_once on;\n        sub_filter '</head>' '${snippet}</head>';\n        # /digital-adoption-preview\n    }`;
 });
 if(!changed)throw new Error('No application proxy found in selected host');return source.slice(0,block.start)+text+source.slice(block.end);
}
