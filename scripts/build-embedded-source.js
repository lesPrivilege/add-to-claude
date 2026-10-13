import { writeFile } from 'node:fs/promises';
import { createEmbeddedSourceScript } from '../web/embedded-source.js';

if (!process.argv[2]) throw new Error('Supply the app resource output path.');
await writeFile(process.argv[2], createEmbeddedSourceScript());
