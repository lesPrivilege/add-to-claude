import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(
  await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'),
);
const digest = createHash('sha256')
  .update(Buffer.from(manifest.key, 'base64'))
  .digest('hex')
  .slice(0, 32);
const id = [...digest].map((char) => String.fromCharCode(97 + parseInt(char, 16))).join('');
const origin = `chrome-extension://${id}/`;
const declaration = await readFile(
  new URL('../native/NativeHostOrigin.swift', import.meta.url),
  'utf8',
);
if (!declaration.includes(`"${origin}"`))
  throw new Error('Native host origin does not match the extension public key.');
process.stdout.write(`Native host origin checked: ${id}\n`);
