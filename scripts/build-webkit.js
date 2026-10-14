import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPageObserverScript } from '../src/page-observer.js';

// Two scripts for the app's WKWebView: the page-world observer, and one self-contained bundle of
// the compiler plus bridge for the app's content world. Each module keeps its own scope.
const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.resolve(process.argv[2] ?? path.join(root, 'dist/webkit'));
const order = [
  'message-visibility',
  'model',
  'import',
  'paged-conversation',
  'chatgpt-response',
  'compile',
  'bridge',
];

export async function bundle() {
  const parts = [];
  for (const name of order) {
    const source = await readFile(path.join(root, 'src', `${name}.js`), 'utf8');
    const names = [
      ...source.matchAll(/^export (?:async )?(?:function|const|let|class) ([A-Za-z_$][\w$]*)/gmu),
    ].map((match) => match[1]);
    const body = source
      .replace(
        /^import \{([^}]+)\} from '\.\/([\w-]+)\.js';$/gmu,
        (_, imports, from) => `const {${imports}} = modules['${from}'];`,
      )
      .replace(/^export (?=(?:async )?(?:function|const|let|class) )/gmu, '');
    if (/^\s*(?:import|export)\b/mu.test(body) || /^const \{[^}]*\bas\b/mu.test(body))
      throw new Error(`Unbundled syntax in ${name}.js`);
    parts.push(`modules['${name}'] = (() => {\n${body}\nreturn { ${names.join(', ')} };\n})();`);
  }
  return `(() => {\nconst modules = {};\n${parts.join('\n')}\n})();\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, 'observer.js'), createPageObserverScript());
  await writeFile(path.join(out, 'bridge.js'), await bundle());
  process.stdout.write(`Built ${out}\n`);
}
