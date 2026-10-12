import {openSync,closeSync,fstatSync,readSync,constants,lstatSync,realpathSync,unlinkSync} from 'node:fs';
import {join,resolve,relative,isAbsolute,basename,extname,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {getDb} from '../db/schema.js';
import {getOpenClawMediaDir,getOpenClawDir} from '../config/openclaw-paths.js';
import {getInboundAttachmentsDir,resolveInboundRelativePath} from './inbound-attachments.js';
import {listContentExplorer} from './content-explorer.js';
import {getOpenClawMediaOwner} from './openclaw-media-ownership.js';
import {scanDownloadBytes,recordDownloadScan} from './content-download-antivirus.js';
import {persistGeneratedOpenClawMedia} from './media-url.js';

export const MULTI_FORMAT_TOOL_NAME='multi-format-content-tool';
export const MULTI_FORMAT_MAX_BYTES=25*1024*1024;
const INPUTS=new Set(['txt','md','html','pdf','docx','doc','xlsx','xls','csv','png','jpg','jpeg','webp','tiff','bmp','formatted']);
const OUTPUTS=new Set(['pdf','docx','doc','xlsx','txt','html','png','jpg']);
const MIME={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',doc:'application/msword',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',txt:'text/plain',html:'text/html',png:'image/png',jpg:'image/jpeg'};
const error=(message,status=422,code='INVALID_CONTENT')=>Object.assign(new Error(message),{status,code});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const normalizedFormat=value=>({word:'docx',excel:'xlsx',text:'txt',markdown:'md',htm:'html',jpeg:'jpg',image:'png'}[String(value||'').toLowerCase()]||String(value||'').toLowerCase());

export function decodeContentBase64(value) {
  if(typeof value!=='string')throw error('Base64 content must be a string.');
  const content=value.replace(/^data:[a-z0-9+./-]+;base64,/i,'');
  if(!content||content.length>Math.ceil(MULTI_FORMAT_MAX_BYTES/3)*4||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content))throw error('Invalid or oversized base64 content.');
  const bytes=Buffer.from(content,'base64');
  if(!bytes.length||bytes.length>MULTI_FORMAT_MAX_BYTES||bytes.toString('base64')!==content)throw error('Invalid or oversized base64 content.');
  return bytes;
}

function readRegularFileUnder(root,path) {
  const base=resolve(root),target=resolve(path),rel=relative(base,target);
  if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw error('File reference is outside the permitted Content Folder.',403,'CONTENT_FORBIDDEN');
  let cursor=base;
  for(const segment of rel.split(sep)) {
    cursor=join(cursor,segment);
    if(lstatSync(cursor).isSymbolicLink())throw error('Symlinked content files are not permitted.',403,'CONTENT_FORBIDDEN');
  }
  const realBase=realpathSync(base),realTarget=realpathSync(target),realRel=relative(realBase,realTarget);
  if(realRel==='..'||realRel.startsWith('..'+sep)||isAbsolute(realRel))throw error('File reference is outside the permitted Content Folder.',403,'CONTENT_FORBIDDEN');
  const fd=openSync(target,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try {
    const stat=fstatSync(fd);
    if(!stat.isFile()||!stat.size||stat.size>MULTI_FORMAT_MAX_BYTES)throw error('Content file must be a regular file of at most 25 MiB.');
    const buffer=Buffer.alloc(Math.min(stat.size+1,MULTI_FORMAT_MAX_BYTES+1));let offset=0;
    while(offset<buffer.length){const n=readSync(fd,buffer,offset,buffer.length-offset,null);if(!n)break;offset+=n;}
    if(offset!==stat.size)throw error('Content file changed during the bounded read; retry with a stable file.',409,'CONTENT_CHANGED');
    return buffer.subarray(0,offset);
  }finally{closeSync(fd);}
}

/** Resolve only the authenticated owner's existing Content Folder. Never an arbitrary host path. */
export function readOwnerContentFile(ownerUserId,reference) {
  if(!ownerUserId)throw error('Authenticated content owner required.',403,'CONTENT_FORBIDDEN');
  const ref=typeof reference==='string'?{relative_path:reference}:reference;
  if(!ref||typeof ref!=='object')throw error('content_file must be a path, item id or object.');
  let raw=String(ref.relative_path||ref.path||ref.id||'').trim(),kind=ref.kind;
  const lookupFilename=!raw&&ref.filename?String(ref.filename):raw&&!/[\\/:%\0]/.test(raw)&&raw!=='.'&&raw!=='..'?raw:null;
  if(lookupFilename) {
    const matches=[];let offset=0,total=0;
    do{const page=listContentExplorer(ownerUserId,{limit:200,offset});total=page.total;if(total>5000)throw error('Use an exact Content Folder item id for this large folder.',409,'CONTENT_REFERENCE_AMBIGUOUS');matches.push(...page.items.filter(item=>item.filename===lookupFilename||basename(item.relative_path||'')===lookupFilename));offset+=200;}while(offset<total);
    if(matches.length!==1)throw error('Filename is missing or ambiguous; use the exact Content Folder item id or relative_path.',409,'CONTENT_REFERENCE_AMBIGUOUS');
    raw=matches[0].relative_path;kind=matches[0].source==='uploaded'?'uploaded':'generated';
  }
  if(raw.startsWith('up:')){raw=raw.slice(3);kind='uploaded';}
  if(raw.startsWith('gen:')){raw=raw.slice(4);kind='generated';}
  raw=raw.replace(/^MEDIA:\s*/i,'').replace(/\\/g,'/');
  if(raw.startsWith('/api/media/openclaw/'))raw=raw.slice('/api/media/openclaw/'.length);
  if(isAbsolute(raw)) {
    const mediaRel=relative(getOpenClawMediaDir(),raw);
    const inboundRel=relative(getInboundAttachmentsDir(ownerUserId),raw);
    if(mediaRel&&!mediaRel.startsWith('..')&&!isAbsolute(mediaRel)){raw=mediaRel.replace(/\\/g,'/');kind='generated';}
    else if(inboundRel&&!inboundRel.startsWith('..')&&!isAbsolute(inboundRel)){raw='inbound/attachments/'+inboundRel.replace(/\\/g,'/');kind='uploaded';}
    else throw error('Absolute paths are accepted only for this owner’s registered content attachments.',403,'CONTENT_FORBIDDEN');
  }
  if(!raw||raw.includes('\0')||raw.includes('%')||raw.split('/').some(part=>!part||part==='.'||part==='..')||/^[a-z]+:/i.test(raw))throw error('Invalid Content Folder reference.',403,'CONTENT_FORBIDDEN');
  if(raw.startsWith('inbound/attachments/'))kind='uploaded';
  if(kind==='uploaded') {
    const path=resolveInboundRelativePath(ownerUserId,raw);
    if(!path)throw error('Content file is not available at that exact reference. Use the returned Content Folder item id; do not invent an inbound path for a generated file. The source file has not been deleted.',404,'CONTENT_NOT_FOUND');
    // Check every segment from the trusted root, not from an agent-writable tenant subfolder.
    return {bytes:readRegularFileUnder(getOpenClawDir(),path),filename:basename(path),reference:raw};
  }
  if(getOpenClawMediaOwner(raw)!==ownerUserId)throw error('Content file is not owned by the authenticated company.',403,'CONTENT_FORBIDDEN');
  const path=join(getOpenClawMediaDir(),...raw.split('/'));
  return {bytes:readRegularFileUnder(getOpenClawDir(),path),filename:basename(path),reference:raw};
}

export async function callContentConverter(payload,{fetchImpl=fetch}={}) {
  const endpoint=process.env.CONTENT_CONVERTER_URL,token=process.env.CONTENT_CONVERTER_TOKEN;
  if(!endpoint||!token)throw error('Multi-format conversion service is not configured.',503,'CONVERTER_UNAVAILABLE');
  const url=new URL(endpoint);
  if(!['content-converter','localhost','127.0.0.1','[::1]'].includes(url.hostname)||!['http:','https:'].includes(url.protocol)||url.username||url.password)throw error('Conversion service must be a private configured endpoint.',503,'CONVERTER_UNAVAILABLE');
  let response;
  try{response=await fetchImpl(new URL('/convert',url),{method:'POST',headers:{'content-type':'application/json','x-content-converter-token':token},body:JSON.stringify(payload),signal:AbortSignal.timeout(125000)});}
  catch{throw error('Conversion service is unreachable or timed out; no file delivered.',503,'CONVERTER_UNAVAILABLE');}
  const length=Number(response.headers.get('content-length')||0);
  if(length>36*1024*1024)throw error('Conversion response exceeds limit.');
  const reader=response.body?.getReader();
  if(!reader)throw error('Conversion service returned an invalid response.',502,'CONVERSION_FAILED');
  const chunks=[];let total=0;
  while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>36*1024*1024){await reader.cancel();throw error('Conversion response exceeds limit.');}chunks.push(value);}
  let result;try{result=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw error('Conversion service returned invalid JSON.',502,'CONVERSION_FAILED');}
  if(!response.ok||result.ok!==true)throw error(result.error||'Conversion failed; no file delivered.',response.status===429?429:422,result.code||'CONVERSION_FAILED');
  return result;
}

/** Scan both directions; publish a multi-file result only after every output is clean. */
export async function multiFormatContentForOwner(ownerUserId,args={},options={}) {
  if(!ownerUserId)throw error('Authenticated content owner required.',403,'CONTENT_FORBIDDEN');
  const progress=event=>{try{options.onProgress?.(event);}catch{}};
  const scanBytes=options.scanBytes||scanDownloadBytes,auditScan=options.auditScan||recordDownloadScan;
  const persistFile=options.persistFile||persistGeneratedOpenClawMedia,convert=options.convert||callContentConverter;
  const operation=args.operation||'convert',ocr=args.ocr||'auto';
  if(!['generate','convert','ocr'].includes(operation)||!['auto','force','off'].includes(ocr))throw error('Invalid operation or OCR mode.');
  const output=normalizedFormat(args.output_format||(operation==='ocr'?'txt':''));
  if(!OUTPUTS.has(output))throw error('output_format must be pdf, docx, doc, xlsx, txt, html, png or jpg.');
  const reference=args.content_file||args.relative_path||args.media_uri;
  const text=args.text??args.content_text;
  const sources=[reference!=null,text!=null,args.content_base64!=null,args.formatted_input!=null].filter(Boolean).length;
  if(sources!==1)throw error('Supply exactly one input: content_file, text, formatted_input or content_base64.');
  let bytes,filename=args.input_filename||args.filename||'',format=normalizedFormat(args.input_format),outputs=[],published=[];
  try {
    if(reference!=null){const source=readOwnerContentFile(ownerUserId,reference);bytes=source.bytes;filename=filename||source.filename;}
    else if(text!=null){if(typeof text!=='string')throw error('text must be a string.');bytes=Buffer.from(text,'utf8');format=format||'txt';}
    else if(args.formatted_input!=null){bytes=Buffer.from(JSON.stringify(args.formatted_input),'utf8');format='formatted';}
    else bytes=decodeContentBase64(args.content_base64);
    format=format||normalizedFormat(extname(filename).slice(1));
    if(!INPUTS.has(format)||!bytes.length||bytes.length>MULTI_FORMAT_MAX_BYTES)throw error('Input format is required and must be supported; size limit is 25 MiB.');
    if(['txt','md','html','csv','formatted'].includes(format))try{new TextDecoder('utf8',{fatal:true}).decode(bytes);}catch{throw error('Text input must be valid UTF-8.');}
    if(format==='pdf'&&!bytes.subarray(0,8).toString('ascii').startsWith('%PDF-'))throw error('Input is not a PDF.');
    if(['docx','xlsx'].includes(format)&&!bytes.subarray(0,4).equals(Buffer.from([80,75,3,4])))throw error('Input is not an Office Open XML file.');
    progress({phase:'content_scan',label:'Scanning conversion input',detail:'ClamAV • processing blocked until clean'});
    const scan=async(data)=>{try{const receipt=await scanBytes(data);if(receipt?.status!=='clean')throw error('Antivirus did not return a clean result.',503,'SCAN_INCOMPLETE');auditScan(ownerUserId,receipt,data);return receipt;}catch(e){auditScan(ownerUserId,{status:e.code||'SCAN_UNAVAILABLE'},data);throw e;}};
    const inputHash=hash(bytes);await scan(bytes);
    progress({phase:operation==='ocr'?'content_ocr':'content_convert',label:operation==='ocr'?'Recognizing document text':'Converting content',detail:`${format} → ${output} • private conversion service`});
    const result=await convert({operation,input_format:format,output_format:output,content_base64:bytes.toString('base64'),ocr,language:args.language||'eng'});
    if(result.ok!==true||!Array.isArray(result.outputs)||!result.outputs.length||result.outputs.length>20||result.output_format!==output)throw error('Conversion service returned an invalid output manifest.',502,'CONVERSION_FAILED');
    let total=0;
    for(const file of result.outputs){
      const data=decodeContentBase64(file.content_base64);total+=data.length;if(total>MULTI_FORMAT_MAX_BYTES)throw error('Combined output exceeds 25 MiB.');
      if(file.mime_type!==MIME[output])throw error('Conversion output MIME does not match requested format.');
      if(output==='pdf'&&(!data.subarray(0,8).toString('ascii').startsWith('%PDF-')||!data.subarray(-2048).includes(Buffer.from('%%EOF'))))throw error('Converter returned an incomplete PDF.');
      if(['docx','xlsx'].includes(output)&&!data.subarray(0,4).equals(Buffer.from([80,75,3,4])))throw error('Converter returned invalid Office bytes.');
      if(output==='doc'&&!data.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex')))throw error('Converter returned invalid legacy Word bytes.');
      if(output==='png'&&!data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))throw error('Converter returned invalid PNG bytes.');
      if(output==='jpg'&&!data.subarray(0,3).equals(Buffer.from('ffd8ff','hex')))throw error('Converter returned invalid JPEG bytes.');
      if(['txt','html'].includes(output))try{new TextDecoder('utf8',{fatal:true}).decode(data);}catch{throw error('Converter returned invalid UTF-8.');}
      outputs.push({bytes:data,mime_type:file.mime_type});
    }
    progress({phase:'content_scan',label:'Scanning converted files',detail:`ClamAV • ${outputs.length} output(s) • nothing published yet`});
    for(const file of outputs)file.scan=await scan(file.bytes);
    for(let i=0;i<outputs.length;i++) {
      const file=outputs[i],name=String(args.output_filename||'converted').replace(/\.[a-z0-9]+$/i,'').replace(/[^a-zA-Z0-9_. -]/g,'_').slice(0,80)||'converted';
      const label=`${name}${outputs.length>1?'-page-'+(i+1):''}.${output}`;
      const artifact=persistFile(file.bytes,label,'downloads',ownerUserId);
      const contentFileId='gen:'+String(artifact.relative_url).replace(/^\/api\/media\/openclaw\//,'');
      published.push({...artifact,content_file_id:contentFileId,filename:label,mime_type:file.mime_type,size_bytes:file.bytes.length,security_scan:{...file.scan,persisted:true,disposition:'attached'}});
    }
    progress({phase:'content_scan_clean',label:'Conversion complete — files scanned',detail:'Owner-private attachments ready'});
    const artifactId='conversion-'+randomUUID();
    const db=getDb();db.exec(`CREATE TABLE IF NOT EXISTS content_conversion_jobs(id TEXT PRIMARY KEY,owner_user_id TEXT NOT NULL,input_sha256 TEXT NOT NULL,input_format TEXT NOT NULL,output_format TEXT NOT NULL,files_json TEXT NOT NULL,created_at TEXT DEFAULT (datetime('now')))`);
    db.prepare('INSERT INTO content_conversion_jobs(id,owner_user_id,input_sha256,input_format,output_format,files_json) VALUES (?,?,?,?,?,?)').run(artifactId,ownerUserId,inputHash,format,output,JSON.stringify(published.map(({relative_url,filename,size_bytes})=>({relative_url,filename,size_bytes}))));
    return {ok:true,artifact_id:artifactId,tool:MULTI_FORMAT_TOOL_NAME,operation,input_format:format,output_format:output,input_sha256:inputHash,ocr_used:!!result.ocr_used,
      warnings:Array.isArray(result.warnings)?result.warnings.map(w=>String(w).slice(0,500)):[],files:published,
      ...(published.length===1?published[0]:{paste_exactly:published.map(f=>f.paste_exactly).join('\n')}),
      summary:'Conversion complete. Paste each files[].paste_exactly on its own line to attach. For another conversion copy files[].content_file_id unchanged into content_file:{id:...}; do not invent an inbound path for generated files. OCR/PDF reconstruction may require review. Source files are unchanged.'};
  }catch(e) {
    // Roll back only files created by this invocation; never delete the source file.
    for(const artifact of published)try{
      const rel=String(artifact.relative_url||'').replace(/^\/api\/media\/openclaw\//,'');
      if(rel.startsWith('downloads/')&&getOpenClawMediaOwner(rel)===ownerUserId){unlinkSync(artifact.local_path);getDb().prepare('DELETE FROM openclaw_media_ownership WHERE relative_path=? AND owner_user_id=?').run(rel,ownerUserId);}
    }catch{}
    progress({phase:'content_rejected',label:'Conversion blocked — no attachment delivered',detail:`${e.code||'CONVERSION_FAILED'} • temporary conversion copies discarded`});
    if(!e.code)e=error('Content could not be converted safely.',e.status||422,'CONVERSION_FAILED');
    e.securityScan={scanner:'ClamAV',status:e.code,disposition:bytes?'temporary_copies_discarded':'not_created',persisted:false,source_file_unchanged:true};
    throw e;
  }finally{bytes?.fill(0);for(const file of outputs)file.bytes.fill(0);}
}
