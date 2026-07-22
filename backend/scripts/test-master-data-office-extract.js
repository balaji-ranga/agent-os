/**
 * Unit smoke: Master Data text extraction for PDF / DOCX / XLSX.
 * Usage: node scripts/test-master-data-office-extract.js
 */
import PDFDocument from 'pdfkit';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { extractTextFromBuffer } from '../src/services/master-data-extract.js';

let failed = 0;
let passed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  } else {
    passed += 1;
    console.log('OK:', msg);
  }
}

function pdfBufferWithText(text) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(12).text(String(text));
    doc.end();
  });
}

async function docxBufferWithText(text) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.folder('_rels').file(
    '.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.folder('word').file(
    'document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p></w:body>
</w:document>`
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

function xlsxBufferWithRows(rows) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Policy');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}

const MARKER = `WidgetRefundWindow${Date.now().toString(36)}`;

console.log('\n=== PDF ===');
const pdfBuf = await pdfBufferWithText(`Refund policy: customers may return within 30 days. Code ${MARKER}.`);
const pdfText = await extractTextFromBuffer(pdfBuf, 'application/pdf', 'policy.pdf');
assert(/30 days/i.test(pdfText), `pdf has 30 days: ${pdfText.slice(0, 80)}`);
assert(pdfText.includes(MARKER), `pdf has marker ${MARKER}`);

console.log('\n=== DOCX ===');
const docxBuf = await docxBufferWithText(`Handbook says PTO is twenty days. Code ${MARKER}.`);
const docxText = await extractTextFromBuffer(
  docxBuf,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'handbook.docx'
);
assert(/twenty days/i.test(docxText), `docx has twenty days: ${docxText.slice(0, 80)}`);
assert(docxText.includes(MARKER), `docx has marker`);

console.log('\n=== XLSX ===');
const xlsxBuf = xlsxBufferWithRows([
  ['sku', 'policy'],
  ['WID-1', `Refund within 14 days ${MARKER}`],
]);
const xlsxText = await extractTextFromBuffer(
  xlsxBuf,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'sku-policy.xlsx'
);
assert(/Refund within 14/i.test(xlsxText), `xlsx has refund: ${xlsxText.slice(0, 120)}`);
assert(/WID-1/.test(xlsxText), 'xlsx has sku');
assert(xlsxText.includes(MARKER), 'xlsx has marker');

console.log('\n=== plain text still works ===');
const txt = await extractTextFromBuffer(Buffer.from('hello master data', 'utf8'), 'text/plain', 'a.txt');
assert(txt.includes('hello master data'), 'plain text');

console.log(`\n=== Done: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
