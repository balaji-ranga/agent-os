import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finished } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import PDFDocument from 'pdfkit';
import { binaryFilePassages } from '../src/services/knowledge-binary-extract.js';

const dir=await mkdtemp(join(tmpdir(),'knowledge-native-ocr-'));
const exec=promisify(execFile);
async function pdf(path,draw) {
  const doc=new PDFDocument({size:'A4'}),out=createWriteStream(path);
  doc.pipe(out);draw(doc);doc.end();await finished(out);
}
async function extract(file) {const out=[];for await(const part of binaryFilePassages(file))out.push(part);return out;}
try {
  const native=join(dir,'native.pdf'),scan=join(dir,'scan.pdf'),raster=join(dir,'raster');
  await pdf(native,doc=>doc.fontSize(24).text('Contract renewal November 15 2026.\nOutstanding amount 4750 SGD.'));
  const text=await extract(native);assert.match(text.map(p=>p.text).join(''),/4750 SGD/);assert.equal(text[0].extraction_method,'text');
  await exec('pdftoppm',['-singlefile','-scale-to','1800','-png',native,raster]);
  await pdf(scan,doc=>doc.image(`${raster}.png`,0,0,{width:595,height:842}));
  const ocr=await extract(scan);assert.match(ocr.map(p=>p.text).join(''),/4750 SGD/);assert.equal(ocr[0].extraction_method,'ocr');
  console.log(JSON.stringify({test:'native-pdf-and-scanned-pdf-ocr',status:'passed',native_pages:text.length,ocr_pages:ocr.length}));
} finally {await rm(dir,{recursive:true,force:true});}
