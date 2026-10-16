// Electron smoke test for the ChatGPT window, run by tests/electron/run.js. Synthetic data only:
// every https request of an in-memory session is answered here, so nothing reaches the network.
// It loads the built helper (preload + chat.js) against a synthetic chatgpt.com page and checks
// the observer → bridge → IPC → hand-off path, the file-link resolver and download with SHA-256,
// and the navigation policy.
import { app, session, shell } from 'electron';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [packageDir, filesRoot] = process.argv.slice(-2);
const report = (result) => {
  process.send?.(result);
  setTimeout(() => app.exit(result.ok ? 0 : 1), 100);
};
const fileBytes = Buffer.from('Synthetic attachment for the smoke test.\n');
const conversation = JSON.stringify({
  conversation_id: 'smoke',
  title: 'Smoke chat',
  current_node: 'a',
  mapping: {
    root: { parent: null, children: ['u'], message: null },
    u: {
      parent: 'root',
      children: ['a'],
      message: {
        id: 'u',
        author: { role: 'user' },
        status: 'finished_successfully',
        content: { content_type: 'text', parts: ['Synthetic question with a file.'] },
        metadata: { attachments: [{ id: 'file-smoke123', name: 'notes.txt' }] },
      },
    },
    a: {
      parent: 'u',
      children: [],
      message: {
        id: 'a',
        author: { role: 'assistant' },
        status: 'finished_successfully',
        end_turn: true,
        content: { content_type: 'text', parts: ['Original **Markdown** 中文 ✓\n'] },
      },
    },
  },
});
// The page fetches its conversation the way ChatGPT does, with an API header the observer keeps.
const page = `<!doctype html><title>Synthetic</title><main>Chat</main><script>
  fetch('/backend-api/conversation/smoke', { headers: { authorization: 'Bearer synthetic' } });
</script>`;

const opened = [];
const seen = [];
shell.openExternal = async (url) => void opened.push(url);

function serve(request) {
  const url = new URL(request.url);
  seen.push(url.href);
  const json = (value) =>
    new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  if (url.hostname === 'chatgpt.com' && url.pathname === '/c/smoke')
    return new Response(page, { headers: { 'content-type': 'text/html' } });
  if (url.hostname === 'chatgpt.com' && url.pathname === '/backend-api/conversation/smoke')
    return new Response(conversation, { headers: { 'content-type': 'application/json' } });
  if (
    url.hostname === 'chatgpt.com' &&
    url.pathname === '/backend-api/files/download/file-smoke123'
  )
    return request.headers.get('authorization') === 'Bearer synthetic'
      ? json({
          download_url: 'https://files.oaiusercontent.com/file-smoke123?sig=synthetic',
          file_name: 'notes.txt',
        })
      : new Response('{}', { status: 401 });
  if (url.hostname === 'files.oaiusercontent.com')
    return new Response(fileBytes, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment; filename="notes.txt"',
      },
    });
  return new Response('not here', { status: 404 });
}

const until = async (check, what, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out: ${what}`);
};

app.whenReady().then(async () => {
  const checks = [];
  const check = (ok, what) => checks.push({ ok: Boolean(ok), what });
  let chat;
  try {
    const partition = `smoke-${process.pid}`;
    session.fromPartition(partition).protocol.handle('https', serve);
    const { ChatWindow } = await import(pathToFileURL(join(packageDir, 'helper/chat.js')).href);
    const states = [];
    chat = new ChatWindow({
      preload: join(packageDir, 'helper/preload.cjs'),
      filesRoot,
      partition,
      start: 'https://chatgpt.com/c/smoke',
      onChange: (state) => states.push(state),
    });
    await until(() => chat.state().source === 'ready', 'the conversation is prepared');
    const prepared = chat.state().conversation;
    check(prepared.title === 'Smoke chat', 'title from the compiled conversation');
    check(prepared.turns === 2 && prepared.files === 1, 'two turns, one file');
    check(
      prepared.verification === 'partial' && prepared.verifiedWithFiles,
      'partial until the file is saved',
    );
    check(
      (await chat.web.executeJavaScript(
        "window[Symbol.for('add-to-claude.passive-observer')] === true",
      )) === true,
      'observer installed in the main world',
    );
    check(
      (await chat.web.executeJavaScript(
        "typeof addToClaudeResolve === 'undefined' && typeof webkit === 'undefined'",
      )) === true,
      'the bridge and its handler are invisible to the page',
    );

    const { markdown, note } = await chat.handOff(true);
    const path = join(filesRoot, 'Smoke chat', 'notes.txt');
    const sha256 = createHash('sha256').update(fileBytes).digest('hex');
    check(readFileSync(path).equals(fileBytes), 'file saved in the conversation folder');
    check(
      markdown.includes(`- notes.txt — \`${path}\` · sha256 ${sha256}`),
      'file line points at the copy with its SHA-256',
    );
    check(
      markdown.includes('verification: verified') && !markdown.includes('Content checks'),
      'verified once the file is saved',
    );
    check(
      markdown.indexOf('Synthetic question') < markdown.indexOf('Original **Markdown** 中文 ✓'),
      'turns in order, original Markdown',
    );
    check(/1 file saved\. 1 file linked\./u.test(note), `note: ${note}`);
    check(chat.state().conversation.saved === 1, 'saved count reported');
    check(
      !states.some(
        (state) => 'markdown' in state || JSON.stringify(state).includes('Synthetic question'),
      ),
      'state never carries the text',
    );

    await chat.web.executeJavaScript("location.href = 'https://example.com/elsewhere'; 1");
    await until(() => opened.length > 0, 'the external link is handed to the browser');
    check(
      opened[0] === 'https://example.com/elsewhere',
      'external link opened in the default browser',
    );
    check(chat.web.getURL() === 'https://chatgpt.com/c/smoke', 'the window stayed on ChatGPT');
    check(
      !seen.some((url) => url.startsWith('https://example.com/')),
      'the external page was never loaded',
    );
    await chat.web.executeJavaScript("location.href = 'file:///etc/hosts'; 1");
    await new Promise((resolve) => setTimeout(resolve, 500));
    check(
      opened.length === 1 && chat.web.getURL() === 'https://chatgpt.com/c/smoke',
      'file: navigation dropped',
    );
    report({ ok: checks.every((item) => item.ok), checks });
  } catch (error) {
    report({ ok: false, checks, error: String(error?.stack ?? error) });
  } finally {
    chat?.close();
  }
});
