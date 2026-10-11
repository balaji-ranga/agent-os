import assert from 'node:assert/strict';
import { mkdtemp, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { binaryFilePassages } from '../src/services/knowledge-binary-extract.js';
import XLSX from 'xlsx';

const dir=await mkdtemp(join(tmpdir(),'knowledge-extract-test-'));
try {
  const commands=[];let extractionDirectory;
  const run=async(name,args,options)=>{
    commands.push(name);assert.equal(options.windowsHide,true);assert.equal(options.timeout,120000);
    if(name==='pdfinfo')return {stdout:'Pages: 2\n'};
    if(name==='pdftotext'){
      extractionDirectory=args.at(-1).replace(/[\\/]page.txt$/,'');
      await writeFile(args.at(-1),args[1]==='1'?'Authoritative native text on page one.':'');
    }
    if(name==='pdftoppm')await writeFile(`${args.at(-1)}.png`,'image fixture');
    if(name==='tesseract')await writeFile(`${args[1]}.txt`,'Scanned renewal terms from second page.');
    return {stdout:''};
  };
  const results=[];
  for await(const passage of binaryFilePassages(join(dir,'input with spaces.pdf'),{run}))results.push(passage);
  assert.deepEqual(results.map(p=>[p.page,p.extraction_method]),[[1,'text'],[2,'ocr']]);
  assert.equal(commands.filter(name=>name==='tesseract').length,1);
  await assert.rejects(access(extractionDirectory));
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['Customer','Amount'],['Acme',4750]]),'Invoices');
  const file=join(dir,'invoice.xlsx');await writeFile(file,XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}));
  const office=[];for await(const passage of binaryFilePassages(file))office.push(passage);
  assert.match(office.map(p=>p.text).join(''),/Acme,4750/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(async()=>{for await(const unused of binaryFilePassages(file,{signal:controller.signal})){}},/abort/i);
  console.log('Binary extraction: per-page native/OCR routing and cleanup harness; real isolated XLSX subprocess and cancellation passed. Native OCR executable validation remains separate.');
} finally {await rm(dir,{recursive:true,force:true});}
