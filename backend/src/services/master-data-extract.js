/**
 * Extract searchable text from Master Data document uploads (PDF / Word / Excel / plain text).
 */
import { extname } from 'path';

const TEXT_EXTS = /\.(txt|md|csv|json|log|xml|html|htm)$/i;
const PDF_EXTS = /\.pdf$/i;
const DOCX_EXTS = /\.docx$/i;
const XLSX_EXTS = /\.(xlsx|xls|xlsm|xlsb)$/i;

function looksLikePdf(buf, mime, filename) {
  const m = String(mime || '').toLowerCase();
  const name = String(filename || '').toLowerCase();
  if (m === 'application/pdf' || PDF_EXTS.test(name)) return true;
  return Buffer.isBuffer(buf) && buf.length >= 5 && buf.slice(0, 5).toString('utf8') === '%PDF-';
}

function looksLikeDocx(mime, filename) {
  const m = String(mime || '').toLowerCase();
  const name = String(filename || '').toLowerCase();
  return (
    DOCX_EXTS.test(name) ||
    m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    m === 'application/vnd.ms-word.document.12'
  );
}

function looksLikeExcel(mime, filename) {
  const m = String(mime || '').toLowerCase();
  const name = String(filename || '').toLowerCase();
  return (
    XLSX_EXTS.test(name) ||
    m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    m === 'application/vnd.ms-excel' ||
    m === 'application/vnd.ms-excel.sheet.macroenabled.12'
  );
}

function looksLikePlainText(mime, filename) {
  const m = String(mime || '').toLowerCase();
  const name = String(filename || '').toLowerCase();
  return m.startsWith('text/') || m.includes('json') || m.includes('csv') || TEXT_EXTS.test(name);
}

async function extractPdfText(buf) {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buf });
  try {
    const result = await parser.getText();
    return String(result?.text || '').trim();
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractDocxText(buf) {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer: buf });
  return String(result?.value || '').trim();
}

async function extractExcelText(buf) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const parts = [];
  for (const sheetName of workbook.SheetNames || []) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    const body = String(csv || '').trim();
    if (!body) continue;
    parts.push(`## Sheet: ${sheetName}\n${body}`);
  }
  return parts.join('\n\n').trim();
}

/**
 * @param {Buffer} buf
 * @param {string} [mime]
 * @param {string} [filename]
 * @returns {Promise<string>}
 */
export async function extractTextFromBuffer(buf, mime, filename) {
  const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  const name = String(filename || 'document');

  if (looksLikePlainText(mime, filename)) {
    return buffer.toString('utf8');
  }

  try {
    if (looksLikePdf(buffer, mime, filename)) {
      const text = await extractPdfText(buffer);
      if (text) return text;
      return `[PDF file: ${name} — no extractable text (may be image-only or empty).]`;
    }
    if (looksLikeDocx(mime, filename)) {
      const text = await extractDocxText(buffer);
      if (text) return text;
      return `[Word file: ${name} — no extractable text.]`;
    }
    if (looksLikeExcel(mime, filename)) {
      const text = await extractExcelText(buffer);
      if (text) return text;
      return `[Excel file: ${name} — no extractable text.]`;
    }
  } catch (err) {
    const msg = err?.message || String(err);
    return `[Failed to extract text from ${name}: ${msg}]`;
  }

  // Legacy .doc (not .docx) and other binaries — metadata stub only
  if (/\.doc$/i.test(name)) {
    return `[Word .doc file: ${name}. Convert to .docx for RAG indexing.]`;
  }

  return `[Binary file: ${name} (${mime || 'unknown type'}, ${buffer.length} bytes). Text content is not indexed; metadata only.]`;
}

export function isOfficeOrPdfDocument(mime, filename) {
  return (
    looksLikePdf(Buffer.alloc(0), mime, filename) ||
    looksLikeDocx(mime, filename) ||
    looksLikeExcel(mime, filename)
  );
}
