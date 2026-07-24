/**
 * Minimal ZIP writer (store or deflate) + reader for extracting entries.
 * No extra npm dependency.
 */
import { createHash } from 'crypto';
import { deflateRawSync, inflateRawSync } from 'zlib';

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
  }
  return ~c >>> 0;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n >>> 0, 0);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

/**
 * @param {Array<{ name: string, content: Buffer|string, compress?: boolean }>} files
 * @returns {Buffer}
 */
export function buildZipBuffer(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(String(file.name).replace(/\\/g, '/'), 'utf8');
    const data = Buffer.isBuffer(file.content) ? file.content : Buffer.from(String(file.content), 'utf8');
    const crc = crc32(data);
    const useDeflate = file.compress !== false && data.length > 256;
    const payload = useDeflate ? deflateRawSync(data) : data;
    const method = useDeflate ? 8 : 0;
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(payload.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      payload,
    ]);
    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(payload.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralDir = Buffer.concat(centrals);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, centralDir, end]);
}

/**
 * Extract first zip entry whose path ends with `suffix` (e.g. '/node.exe').
 * @param {Buffer} zipBuf
 * @param {string} suffix
 * @returns {Buffer|null}
 */
export function extractZipEntryBySuffix(zipBuf, suffix) {
  const needle = String(suffix || '').replace(/\\/g, '/').toLowerCase();
  if (!needle || !Buffer.isBuffer(zipBuf)) return null;

  let offset = 0;
  while (offset + 30 <= zipBuf.length) {
    const sig = zipBuf.readUInt32LE(offset);
    if (sig === 0x02014b50 || sig === 0x06054b50) break;
    if (sig !== 0x04034b50) {
      offset += 1;
      continue;
    }
    const method = zipBuf.readUInt16LE(offset + 8);
    const compSize = zipBuf.readUInt32LE(offset + 18);
    const uncompSize = zipBuf.readUInt32LE(offset + 22);
    const nameLen = zipBuf.readUInt16LE(offset + 26);
    const extraLen = zipBuf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = zipBuf.slice(nameStart, nameStart + nameLen).toString('utf8').replace(/\\/g, '/');
    const dataStart = nameStart + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > zipBuf.length) break;

    if (name.toLowerCase().endsWith(needle) && !name.endsWith('/')) {
      const compressed = zipBuf.slice(dataStart, dataEnd);
      if (method === 0) return compressed;
      if (method === 8) {
        const out = inflateRawSync(compressed);
        if (uncompSize && out.length !== uncompSize) {
          // still return inflated data
        }
        return out;
      }
      throw new Error(`Unsupported zip compression method ${method} for ${name}`);
    }
    offset = dataEnd;
  }
  return null;
}

export function contentSha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}
