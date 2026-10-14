import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const source = new URL('../assets/fonts/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', source), 'utf8'));
const target = fileURLToPath(new URL('../public/fonts/travel-sans.ttf', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const matches = (bytes, entry) => bytes.length === entry.size && sha256(bytes) === entry.sha256;

if (manifest.version !== 1 || manifest.archive.format !== 'gzip' || manifest.original.file !== 'travel-sans.ttf') {
  throw new Error('Unsupported font resource manifest.');
}

if (existsSync(target) && matches(readFileSync(target), manifest.original)) {
  console.log('Chinese PDF font is ready.');
} else {
  const chunks = manifest.parts.map(part => {
    if (!/^travel-sans\.ttf\.gz\.part-\d{3}$/.test(part.file)) throw new Error('Invalid font part name.');
    const bytes = readFileSync(new URL(part.file, source));
    if (!matches(bytes, part)) throw new Error(`Font resource is incomplete: ${part.file}`);
    return bytes;
  });
  const archive = Buffer.concat(chunks);
  if (!matches(archive, manifest.archive)) throw new Error('Compressed font checksum mismatch.');
  const font = gunzipSync(archive, { maxOutputLength: manifest.original.size });
  if (!matches(font, manifest.original)) throw new Error('Chinese PDF font checksum mismatch.');
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, font);
    renameSync(temporary, target);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  console.log(`Prepared Chinese PDF font (${font.length} bytes).`);
}
