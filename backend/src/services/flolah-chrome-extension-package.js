/** Build the source-only MV3 Flolah Chrome extension ZIP. No credentials are embedded. */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { buildZipBuffer } from './zip-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..', 'flolah-chrome-extension');

function files(dir, base = dir) {
  const output = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) output.push(...files(full, base));
    else output.push({ name: relative(base, full).replace(/\\/g, '/'), content: readFileSync(full), compress: true });
  }
  return output;
}

export async function buildFlolahChromeExtensionZip() {
  if (!existsSync(ROOT)) throw new Error('Flolah Chrome extension source is missing');
  return {
    zip: await buildZipBuffer(files(ROOT)),
    filename: 'flolah-chrome-extension.zip',
  };
}
