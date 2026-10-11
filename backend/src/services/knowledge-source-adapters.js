import { realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getBusinessProfile, assertCrmEntitled, assertErpEntitled } from './company-business-profile.js';
import { erpList, erpGet } from './erpnext-erp.js';
import { versionedSource } from './knowledge-versioned-source.js';
import { crmKnowledgePage, crmKnowledgeRecord } from './twenty-crm.js';
import { listContentExplorer, resolveContentExplorerDownload } from './content-explorer.js';
import { isRagIndexable } from './master-data-extract.js';
import { localKnowledgeRecords } from './knowledge-local-records.js';
import { fingerprint } from './knowledge-contract.js';
import { textFilePassages } from './knowledge-text-stream.js';
import { binaryFilePassages, isKnowledgeOcrImage } from './knowledge-binary-extract.js';
import { mailRecords, mailConnectionRef } from './knowledge-mail-adapter.js';

const ERP_FIELDS = {
  Customer: ['name', 'customer_name', 'customer_type', 'modified'],
  Contact: ['name', 'first_name', 'last_name', 'email_id', 'modified'],
  Opportunity: ['name', 'opportunity_from', 'party_name', 'status', 'modified'],
  Project: ['name', 'project_name', 'customer', 'status', 'modified'],
  'Sales Invoice': ['name', 'customer', 'project', 'status', 'due_date', 'outstanding_amount', 'grand_total', 'currency', 'modified'],
};
export function knowledgeConnectionRef(owner,kind,profile=getBusinessProfile(owner)) {
  if(['gmail','outlook'].includes(kind))return mailConnectionRef(owner,kind);
  if(kind==='crm')return fingerprint([owner,kind,profile.crm_provider,profile.crm_provider==='twenty'?profile.twenty?.workspace_id:profile.erpnext?.company_id]);
  if(kind==='erp')return fingerprint([owner,kind,profile.erp_provider,profile.erpnext?.company_id]);
  return fingerprint([owner,kind]);
}
export async function assertKnowledgeSourceAccess(owner, source) {
  if(!source)throw new Error('Knowledge source no longer exists');
  const profile = getBusinessProfile(owner);
  if (source.kind === 'crm') {
    assertCrmEntitled(owner);
    if (!['twenty', 'erpnext'].includes(profile.crm_provider)) throw new Error('Configure a supported CRM connection first');
  }
  if (source.kind === 'erp') {
    assertErpEntitled(owner);
    if (profile.erp_provider !== 'erpnext') throw new Error('Configure ERPNext first');
  }
  const ref=await knowledgeConnectionRef(owner,source.kind,profile);
  if(source.connection_ref&&source.connection_ref!==ref)throw new Error('Source connection changed. Edit and resynchronize this knowledge source.');
  return profile;
}
export function businessRecord(collection, row, kind) {
  const id = String(row.id || row.name || '');
  if (!id) throw new Error('Source record has no stable ID');
  const relations = [];
  if (kind === 'erp' && row.customer) relations.push({ target: `Customer/${row.customer}`, relation: 'customer' });
  if (kind === 'erp' && row.project) relations.push({ target: `Project/${row.project}`, relation: 'project' });
  if (kind === 'crm' && row.companyId) relations.push({ target: `companies/${row.companyId}`, relation: 'company' });
  // Explicit safe projections avoid placing provider credentials/metadata into search.
  const fields = kind === 'erp' ? ERP_FIELDS[collection] : ['id','name','emails','phones','domainName','companyId','stage','amount','closeDate'];
  const data = Object.fromEntries(fields.filter(k => row[k] != null).map(k => [k,row[k]]));
  const personName = [row.name?.firstName ?? row.first_name,row.name?.lastName ?? row.last_name].filter(value=>typeof value==='string'&&value.trim()).join(' ');
  return { object_id: `${collection}/${id}`, title: String(row.customer_name || row.project_name || personName || (typeof row.name === 'string' ? row.name : '') || id),
    text: JSON.stringify(data), fields: data, relations, modified_at: row.modified || row.updatedAt || null };
}
export async function* sourceRecords(owner, source, {signal,incremental,dependencies={}}={}) {
  const access=dependencies.access||assertKnowledgeSourceAccess;
  const crmPage=dependencies.crmPage||crmKnowledgePage,crmRead=dependencies.crmRead||crmKnowledgeRecord;
  const erpPage=dependencies.erpPage||erpList,erpRead=dependencies.erpRead||erpGet;
  const profile = await access(owner,source);
  if(['gmail','outlook'].includes(source.kind)) {yield* mailRecords(owner,source,{signal,incremental});await access(owner,source);return;}
  for (const collection of source.collections) {
    if (source.kind === 'knowledge') {
      yield* localKnowledgeRecords(owner, collection,{signal,incremental});
    } else if (source.kind === 'content') {
      for (let offset=0;;offset+=100) {
        const page = listContentExplorer(owner,{source:collection,limit:100,offset});
        for (const item of page.items) {
          signal?.throwIfAborted();
          if (!isRagIndexable(item.mime_guess,item.filename)&&!isKnowledgeOcrImage(item.filename)) continue;
          const file = resolveContentExplorerDownload(owner,{kind:collection,path:item.relative_path});
          const actual = await realpath(file.absolute_path);
          if (resolve(actual) !== resolve(file.absolute_path)) throw new Error('Symlinked content is not eligible for indexing');
          const info = await stat(actual);
          yield* versionedSource(`${collection}/${item.relative_path}`,[info.size,info.mtimeMs,info.ctimeMs,item.download_url],async function*(){
            const passages=/\.(txt|md|csv|json|log|xml|html|htm)$/i.test(file.filename)?textFilePassages(actual):binaryFilePassages(actual,{filename:file.filename,signal});
            let sequence=0;
            yield {object_id:item.relative_path,title:item.filename,text:`Document: ${item.filename}`,fields:{bytes:info.size},relations:[],modified_at:info.mtime.toISOString(),url:item.download_url};
            for await(const passage of passages)yield {
              object_id:`${item.relative_path}#passage-${sequence++}`,title:item.filename,text:passage.text,
              fields:{character_offset:passage.offset,page:passage.page,extraction_method:passage.extraction_method||'text'},relations:[{target:item.relative_path,relation:'passage_of'}],
              modified_at:info.mtime.toISOString(),url:item.download_url,
            };
            const after=await stat(actual);
            if(after.size!==info.size||after.mtimeMs!==info.mtimeMs)throw new Error('Content changed during streaming; synchronization will retry');
          },incremental);
        }
        if (!page.has_more) break;
      }
    } else if (source.kind === 'crm' && profile.crm_provider === 'twenty') {
      let cursor = null; const seen = new Set();
      do {
        const page = await crmPage(owner,collection,cursor,{metadataOnly:!!incremental});
        for (const row of page.rows) {
          if(typeof row.id!=='string'||!row.id)throw new Error('CRM record has no stable ID');
          yield* versionedSource(`${collection}/${row.id}`,row.updatedAt||null,async function*(){
            yield businessRecord(collection,incremental?await crmRead(owner,collection,row.id):row,'crm');
          },incremental);
        }
        cursor = page.cursor;
        if (cursor && seen.has(cursor)) throw new Error('CRM repeated a pagination cursor');
        seen.add(cursor);
      } while(cursor);
    } else {
      const type = source.kind === 'crm' ? {companies:'Customer',people:'Contact',opportunities:'Opportunity'}[collection] : collection;
      if (!ERP_FIELDS[type]) throw new Error(`Knowledge adapter for ${type} is not available`);
      for(let offset=0;;offset+=100) {
        const page = await erpPage(owner,type,{limit:100,offset,stableOrder:true,fields:incremental?['name','modified']:ERP_FIELDS[type]});
        if(page.mode !== 'live' || page.note) throw new Error(page.error || 'ERP requires complete, tenant-filtered pagination');
        for(const row of page.data) {
          signal?.throwIfAborted();
          yield* versionedSource(`${type}/${row.name}`,row.modified||null,async function*(){
            const result=incremental?await erpRead(owner,type,row.name):{mode:'live',data:row};
            if(result.mode!=='live'||!result.data||result.note)throw new Error('ERP record changed or became unavailable during synchronization');
            yield businessRecord(type,result.data,'erp');
          },incremental);
        }
        if(page.has_more===false||(page.has_more==null&&page.data.length<100)) break;
      }
    }
  }
  await access(owner,source);
}
