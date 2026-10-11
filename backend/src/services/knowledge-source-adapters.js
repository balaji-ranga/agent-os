import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getBusinessProfile, assertCrmEntitled, assertErpEntitled } from './company-business-profile.js';
import { erpList } from './erpnext-erp.js';
import { crmKnowledgePage } from './twenty-crm.js';
import { listContentExplorer, resolveContentExplorerDownload } from './content-explorer.js';
import { extractTextFromBuffer, isRagIndexable } from './master-data-extract.js';

const ERP_FIELDS = {
  Customer: ['name', 'customer_name', 'customer_type', 'modified'],
  Contact: ['name', 'first_name', 'last_name', 'email_id', 'modified'],
  Opportunity: ['name', 'opportunity_from', 'party_name', 'status', 'modified'],
  Project: ['name', 'project_name', 'customer', 'status', 'modified'],
  'Sales Invoice': ['name', 'customer', 'project', 'status', 'due_date', 'outstanding_amount', 'grand_total', 'currency', 'modified'],
};
export function assertKnowledgeSourceAccess(owner, source) {
  const profile = getBusinessProfile(owner);
  if (source.kind === 'crm') {
    assertCrmEntitled(owner);
    if (!['twenty', 'erpnext'].includes(profile.crm_provider)) throw new Error('Configure a supported CRM connection first');
  }
  if (source.kind === 'erp') {
    assertErpEntitled(owner);
    if (profile.erp_provider !== 'erpnext') throw new Error('Configure ERPNext first');
  }
  return profile;
}
function businessRecord(collection, row, kind) {
  const id = String(row.id || row.name || '');
  if (!id) throw new Error('Source record has no stable ID');
  const relations = [];
  if (kind === 'erp' && row.customer) relations.push({ target: `Customer/${row.customer}`, relation: 'customer' });
  if (kind === 'erp' && row.project) relations.push({ target: `Project/${row.project}`, relation: 'project' });
  if (kind === 'crm' && row.companyId) relations.push({ target: `companies/${row.companyId}`, relation: 'company' });
  // Explicit safe projections avoid placing provider credentials/metadata into search.
  const fields = kind === 'erp' ? ERP_FIELDS[collection] : ['id','name','emails','phones','domainName','companyId','stage','amount','closeDate'];
  const data = Object.fromEntries(fields.filter(k => row[k] != null).map(k => [k,row[k]]));
  return { object_id: `${collection}/${id}`, title: String(row.customer_name || row.project_name || (typeof row.name === 'string' ? row.name : '') || id),
    text: JSON.stringify(data), fields: data, relations, modified_at: row.modified || row.updatedAt || null };
}
export async function* sourceRecords(owner, source) {
  const profile = assertKnowledgeSourceAccess(owner,source);
  for (const collection of source.collections) {
    if (source.kind === 'content') {
      for (let offset=0;;offset+=100) {
        const page = listContentExplorer(owner,{source:collection,limit:100,offset});
        for (const item of page.items) {
          if (!isRagIndexable(item.mime_guess,item.filename)) continue;
          const file = resolveContentExplorerDownload(owner,{kind:collection,path:item.relative_path});
          const actual = await realpath(file.absolute_path);
          if (resolve(actual) !== resolve(file.absolute_path)) throw new Error('Symlinked content is not eligible for indexing');
          const info = await stat(actual);
          // Explicitly visible error; large-file streaming is a separate ingestion stage.
          if (info.size > 15*1024*1024) throw new Error(`Content requires large-file extraction: ${item.filename}`);
          const text = await extractTextFromBuffer(await readFile(actual),file.mime,file.filename);
          yield {object_id:item.relative_path,title:item.filename,text,fields:{},relations:[],modified_at:info.mtime.toISOString(),url:item.download_url};
        }
        if (!page.has_more) break;
      }
    } else if (source.kind === 'crm' && profile.crm_provider === 'twenty') {
      let cursor = null; const seen = new Set();
      do {
        const page = await crmKnowledgePage(owner,collection,cursor);
        for (const row of page.rows) yield businessRecord(collection,row,'crm');
        cursor = page.cursor;
        if (cursor && seen.has(cursor)) throw new Error('CRM repeated a pagination cursor');
        seen.add(cursor);
      } while(cursor);
    } else {
      const type = source.kind === 'crm' ? {companies:'Customer',people:'Contact',opportunities:'Opportunity'}[collection] : collection;
      if (!ERP_FIELDS[type]) throw new Error(`Knowledge adapter for ${type} is not available`);
      for(let offset=0;;offset+=100) {
        const page = await erpList(owner,type,{limit:100,offset,stableOrder:true,fields:ERP_FIELDS[type]});
        if(page.mode !== 'live' || page.note) throw new Error(page.error || 'ERP requires complete, tenant-filtered pagination');
        for(const row of page.data) yield businessRecord(type,row,'erp');
        if(page.data.length<100) break;
      }
    }
  }
}
