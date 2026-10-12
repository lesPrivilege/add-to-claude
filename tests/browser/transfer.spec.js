import { test, expect } from '@playwright/test';
import { demoConversation, projectMarkdown } from '../../src/model.js';
import { mkdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

async function desk(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toBeHidden();
}
async function composer(context, title = 'Field notes') {
  const page = await context.newPage();
  await page.goto(`/composer.html?title=${encodeURIComponent(title)}`);
  await expect(page.locator('#composer-state')).toHaveText('Ready to receive');
  return page;
}
async function choose(page, name) {
  await page.locator('#target-picker').click();
  await page
    .locator('#target-dialog')
    .getByRole('button', { name: new RegExp(name) })
    .click();
}
async function demo(page) {
  await page.locator('#demo-btn').click();
  await expect(page.locator('#verification')).toContainText('verified');
}
async function importModel(page, model) {
  await page.locator('#import-file').setInputFiles({
    name: 'synthetic-conversation.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(model)),
  });
  await expect(page.locator('#conversation-title')).toHaveText(model.source.title);
}

test('renders a compact keyboard-accessible desk and review without HTML execution', async ({
  page,
}) => {
  await desk(page);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/01-transfer-desk.png' });
  await page.locator('#paste-btn').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#paste-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#paste-dialog')).toBeHidden();
  await expect(page.locator('#paste-btn')).toBeFocused();
  await demo(page);
  await page.locator('#preview-btn').click();
  await expect(page.locator('#preview-content')).toContainText('const note');
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 360, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/02-compact-review.png' });
});

test('verified insertion appends exact long Markdown, links and attachment bytes to selected window', async ({
  page,
  context,
}) => {
  const target = await composer(context, 'Design notes');
  const wrong = await composer(context, 'Other window');
  await target.locator('#editor').fill('Existing draft — keep me.');
  await target.waitForTimeout(2700);
  await desk(page);
  const model = demoConversation();
  model.source.title = 'Long synthetic conversation';
  model.turns[0].markdown +=
    '\n\n' +
    'A long line with **Markdown**, 日本語, and https://example.com/reference.\n'.repeat(4000);
  delete model.turns[0].originalParts;
  await importModel(page, model);
  await page.locator('#attachment-files').setInputFiles([
    {
      name: 'notes.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Synthetic attachment\n\nOnly test material.\n'),
    },
    { name: 'data.csv', mimeType: 'text/csv', buffer: Buffer.from('name,value\nalpha,42\n') },
  ]);
  await choose(page, 'Design notes');
  await expect(page.locator('#draft-controls')).toBeVisible();
  await page.locator('#transfer-btn').click();
  await expect(page.locator('#status')).toContainText('Added to Design notes.');
  const value = await target.locator('#editor').inputValue();
  expect(value).toContain('Existing draft — keep me.\n\nConversation context');
  expect(value).toContain(projectMarkdown(model));
  await expect(wrong.locator('#editor')).toHaveValue('');
  await expect(target.locator('#composer-files')).toContainText('notes.md');
  await expect(target.locator('#composer-files')).toContainText('bytes verified');
  await expect(target.locator('#editor')).toBeFocused();
  await page.screenshot({ path: 'artifacts/03-confirmed-transfer.png' });
  await target.screenshot({ path: 'artifacts/04-composer-receipt.png' });
});

test('clipboard fallback says Copied and never claims Added', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await desk(page);
  await demo(page);
  await choose(page, '^Claude Desktop');
  await page.locator('#transfer-btn').click();
  await expect(page.locator('#status')).toContainText('Copied. Paste into Claude');
  await expect(page.locator('#status')).not.toContainText('Added');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('A quieter launch');
});

test('failure is actionable, retry works, replacement requires explicit choice', async ({
  page,
  context,
}) => {
  const target = await composer(context, 'Retry composer');
  await target.locator('#fail-next').check();
  await desk(page);
  await demo(page);
  await choose(page, 'Retry composer');
  await page.locator('#transfer-btn').click();
  await expect(page.locator('#status')).toHaveClass(/error/);
  await expect(target.locator('#editor')).toHaveValue('');
  await expect(page.locator('#transfer-btn')).toBeEnabled();
  await page.locator('#transfer-btn').click();
  await expect(page.locator('#status')).toContainText('Added to Retry composer');
  await choose(page, 'Retry composer');
  await page.locator('[name="draft-mode"][value="replace"]').check();
  await page.locator('#transfer-btn').click();
  await expect(page.locator('#status')).toContainText('Added to Retry composer');
  expect(
    (await target.locator('#editor').inputValue()).match(/Conversation context/g),
  ).toHaveLength(1);
});

test('cancel revokes pending content without writing and wrong conversation prevents insertion', async ({
  page,
  context,
}) => {
  const target = await composer(context, 'Hold composer');
  await target.locator('#hold-next').check();
  await desk(page);
  await demo(page);
  await choose(page, 'Hold composer');
  await page.locator('#transfer-btn').click();
  await expect(page.locator('#cancel-btn')).toBeVisible();
  await page.locator('#cancel-btn').click();
  await expect(page.locator('#status')).toContainText('Cancelled. Nothing was added.');
  await target.locator('#hold-next').uncheck();
  await target.waitForTimeout(600);
  await expect(target.locator('#editor')).toHaveValue('');
  await choose(page, 'Hold composer');
  await target.locator('#new-conversation').click();
  await page.locator('#transfer-btn').click();
  await expect(page.locator('#status')).toContainText('draft changed');
  await expect(target.locator('#editor')).toHaveValue('');
});

test('paused, closed, and changed draft targets cannot receive stale transfers', async ({
  page,
  context,
}) => {
  const target = await composer(context, 'Guarded composer');
  await desk(page);
  await demo(page);
  await choose(page, 'Guarded composer');
  await target.locator('#receiving').uncheck();
  await page.locator('#transfer-btn').click();
  await expect(page.locator('#status')).toContainText('paused');
  await target.locator('#receiving').check();
  await choose(page, 'Guarded composer');
  await target.locator('#editor').fill('Changed since selection');
  await target.waitForTimeout(2700);
  await page.locator('#transfer-btn').click();
  await expect(page.locator('#status')).toContainText('draft changed');
  await expect(target.locator('#editor')).toHaveValue('Changed since selection');
});

test('manual paste is explicitly unverified, preserves fenced headings, and needs review', async ({
  page,
}) => {
  await desk(page);
  await page.locator('#paste-btn').click();
  await page
    .locator('#paste-content')
    .fill(
      '## User\nA question\n\n## Assistant\n```md\n## User\nnot a turn\n```\n[Source](https://example.com)\n<img src=x onerror=alert(1)>',
    );
  await page.locator('#use-paste').click();
  await expect(page.locator('#paste-dialog')).toBeHidden();
  await expect(page.locator('#conversation-meta')).toContainText('2 turns');
  await expect(page.locator('#verification')).toContainText('unverified');
  await choose(page, '^Claude Desktop');
  await expect(page.locator('#transfer-btn')).toBeDisabled();
  await page.locator('#accept-unverified').check();
  await expect(page.locator('#transfer-btn')).toBeEnabled();
  await page.locator('#preview-btn').click();
  await expect(page.locator('#preview-content')).toContainText('<img');
  await expect(page.locator('#preview-content img')).toHaveCount(0);
});

test('selected export branch is imported without another conversation, files and streaming expose gaps', async ({
  page,
}) => {
  const node = (id, parent, role, text, children = []) => ({
    id,
    parent,
    children,
    message: {
      id,
      author: { role },
      content: { content_type: 'text', parts: [text] },
      status: 'finished_successfully',
      metadata: {},
    },
  });
  const raw = [
    {
      id: 'one',
      title: 'Selected synthetic branch',
      current_node: 'a',
      mapping: {
        r: { id: 'r', parent: null, children: ['u'], message: null },
        u: node('u', 'r', 'user', 'One question', ['a', 'b']),
        a: node('a', 'u', 'assistant', 'Current answer'),
        b: node('b', 'u', 'assistant', 'Alternate answer'),
      },
    },
    {
      id: 'two',
      title: 'Not selected',
      current_node: 'z',
      mapping: { z: node('z', null, 'user', 'DO NOT TRANSFER THIS') },
    },
  ];
  await desk(page);
  await page.locator('#import-file').setInputFiles({
    name: 'conversations.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(raw)),
  });
  await expect(page.locator('#import-dialog')).toBeVisible();
  await page.locator('#branch-select').selectOption('b');
  await page.locator('#use-import').click();
  await expect(page.locator('#conversation-meta')).toContainText('2 turns');
  await page.locator('#preview-btn').click();
  await expect(page.locator('#preview-content')).toContainText('Alternate answer');
  await expect(page.locator('#preview-content')).not.toContainText('Current answer');
  await expect(page.locator('#preview-content')).not.toContainText('DO NOT TRANSFER THIS');
});

test('unsafe attachment names/types and oversized files fail before transport', async ({
  page,
}) => {
  await desk(page);
  await demo(page);
  await page
    .locator('#attachment-files')
    .setInputFiles({ name: 'run.sh', mimeType: 'text/plain', buffer: Buffer.from('echo no') });
  await expect(page.locator('#status')).toContainText('Use text, Markdown');
  await page.locator('#attachment-files').setInputFiles({
    name: 'large.txt',
    mimeType: 'text/plain',
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(page.locator('#status')).toContainText('exceeds 5 MB');
});

test('attachment binding saves fingerprint and locator, reimport needs bytes, and empty MIME works', async ({
  page,
  context,
}) => {
  const target = await composer(context, 'Attachment source');
  await desk(page);
  const model = demoConversation();
  model.attachments = [
    {
      id: 'source-attachment',
      name: 'source-notes.md',
      sourceLocator: 'synthetic:demo/4/file/1',
      status: 'expired',
      turnId: 'demo-4',
    },
  ];
  model.verification = {
    status: 'partial',
    issues: [
      {
        code: 'expired-file',
        message: 'Source download expired. Select a normal downloaded copy.',
      },
    ],
  };
  await importModel(page, model);
  const bytes = Buffer.from('# Downloaded synthetic copy\n');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Select downloaded file for source-notes.md' }).click();
  await (await chooser).setFiles({ name: 'downloaded-notes.md', mimeType: '', buffer: bytes });
  await expect(page.locator('#status')).toContainText('file selected');
  const download = page.waitForEvent('download');
  await page.locator('#save-btn').click();
  const saved = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(saved.attachments[0]).toMatchObject({
    id: 'source-attachment',
    name: 'source-notes.md',
    localName: 'downloaded-notes.md',
    sourceLocator: 'synthetic:demo/4/file/1',
    status: 'available',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  expect(saved.attachments[0]).not.toHaveProperty('base64');
  await page.locator('#accept-unverified').check();
  await choose(page, 'Attachment source');
  await page.locator('#transfer-btn').click();
  await expect(page.locator('#status')).toContainText('1 file attached');
  await expect(target.locator('#composer-files')).toContainText('downloaded-notes.md');
  await importModel(page, saved);
  await expect(page.locator('#attachment-list')).toContainText('File needed');
  await expect(page.locator('#verification')).toContainText('Partial');
  const mismatched = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Select downloaded file for source-notes.md' }).click();
  await (
    await mismatched
  ).setFiles({ name: 'other.md', mimeType: '', buffer: Buffer.from('different') });
  await expect(page.locator('#status')).toContainText('does not match the saved SHA-256');
});

test('slow attachment reads block transfer and cannot attach to a replaced source', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      await new Promise((resolve) => {
        window.releaseFileRead = resolve;
      });
      return original.call(this);
    };
  });
  await desk(page);
  await demo(page);
  await choose(page, '^Claude Desktop');
  await page.locator('#attachment-files').setInputFiles({
    name: 'slow.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('Synthetic'),
  });
  await expect(page.locator('#transfer-btn')).toBeDisabled();
  await page.locator('#clear-btn').click();
  await page.evaluate(() => window.releaseFileRead());
  await expect(page.locator('#status')).toContainText('Conversation changed while reading files');
  await expect(page.locator('#source-empty')).toBeVisible();
  await demo(page);
  await expect(page.locator('#attachment-list')).toBeEmpty();
});

test('normal browser downloads selected together bind receipt hints and transfer exact bytes', async ({
  page,
  context,
}, testInfo) => {
  const files = [
    {
      id: 'source-report',
      name: 'report.csv',
      localName: 'report (1).csv',
      body: 'name,value\nalpha,42\n',
      type: 'text/csv',
    },
    {
      id: 'source-notes',
      name: 'notes.md',
      localName: 'notes.md',
      body: '# Synthetic download\n\n[Reference](https://example.org/)\n',
      type: 'text/markdown',
    },
  ];
  const source = await context.newPage();
  const downloadServer = createServer((request, response) => {
    const file = files.find((item) => request.url === `/${item.id}`);
    response.writeHead(
      200,
      file
        ? {
            'content-type': file.type,
            'content-disposition': `attachment; filename="${file.localName}"`,
          }
        : { 'content-type': 'text/html; charset=utf-8' },
    );
    response.end(
      file ? file.body : files.map((item) => `<a href="/${item.id}">${item.name}</a>`).join('\n'),
    );
  });
  await new Promise((resolve) => downloadServer.listen(0, '127.0.0.1', resolve));
  const paths = [];
  try {
    await source.goto(`http://127.0.0.1:${downloadServer.address().port}/`);
    for (const file of files) {
      const waiting = source.waitForEvent('download');
      await source.getByRole('link', { name: file.name, exact: true }).click();
      const download = await waiting;
      expect(download.suggestedFilename()).toBe(file.localName);
      const path = testInfo.outputPath(file.localName);
      await download.saveAs(path);
      expect(await readFile(path, 'utf8')).toBe(file.body);
      paths.push(path);
    }
  } finally {
    await source.close();
    await new Promise((resolve) => downloadServer.close(resolve));
  }
  const target = await composer(context, 'Downloaded files');
  await desk(page);
  const model = demoConversation();
  model.attachments = files.map((file) => ({
    id: file.id,
    name: file.name,
    status: 'download-needed',
    sourceLocator: `synthetic:download/${file.id}`,
    url: `https://download-fixture.example/${file.id}`,
    // Extension download API completion is tested separately; its metadata contains no file bytes.
    download: { name: file.localName, size: Buffer.byteLength(file.body) },
  }));
  await importModel(page, model);
  await expect(page.locator('#attach-btn')).toHaveText('Select downloaded files');
  await expect(page.locator('#attachment-list')).toContainText('Downloaded · select file');
  await page.locator('#attachment-files').setInputFiles(paths);
  await expect(page.locator('#status')).toContainText('Matched recorded download names and sizes');
  const saving = page.waitForEvent('download');
  await page.locator('#save-btn').click();
  const saved = JSON.parse(await readFile(await (await saving).path(), 'utf8'));
  expect(saved.attachments).toHaveLength(2);
  for (const [index, file] of files.entries())
    expect(saved.attachments[index]).toMatchObject({
      id: file.id,
      localName: file.localName,
      sourceLocator: `synthetic:download/${file.id}`,
      sha256: createHash('sha256').update(file.body).digest('hex'),
      status: 'available',
    });
  await choose(page, 'Downloaded files');
  await page.locator('#accept-unverified').check();
  await page.locator('#transfer-btn').click();
  await expect(page.locator('#status')).toContainText('2 files attached');
  for (const file of files)
    await expect(target.locator('#composer-files')).toContainText(file.localName);
  await expect(target.locator('#composer-files')).toContainText('bytes verified');
});

test('download name and size hints reject mismatches and ambiguous automatic association', async ({
  page,
}) => {
  await desk(page);
  const model = demoConversation();
  const attachment = {
    id: 'first',
    name: 'notes.md',
    sourceLocator: 'synthetic:first',
    status: 'download-needed',
    download: { name: 'notes.md', size: 5 },
  };
  model.attachments = [
    attachment,
    { ...attachment, id: 'second', sourceLocator: 'synthetic:second' },
  ];
  await importModel(page, model);
  await page
    .locator('#attachment-files')
    .setInputFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('hello') });
  await expect(page.locator('#status')).toContainText('matches more than one download');
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Select downloaded file for notes.md' }).first().click();
  await (
    await choosing
  ).setFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('wrong length') });
  await expect(page.locator('#status')).toContainText('recorded by Chrome for this source file');
  await expect(page.locator('#attachment-list')).not.toContainText('Selected');
});

test('expired claim response never writes the controlled draft', async ({ page, context }) => {
  const target = await composer(context, 'Expired lease');
  await target.route('**/api/transfers/*/claim', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, expiresAt: Date.now() - 1 } });
  });
  await desk(page);
  await demo(page);
  await choose(page, 'Expired lease');
  await page.locator('#transfer-btn').click();
  await expect(page.locator('#status')).toHaveClass(/error/);
  await expect(target.locator('#editor')).toHaveValue('');
});

test('clipboard denial gives retry action and never success', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator.clipboard, 'writeText', {
      value: async () => {
        throw new DOMException('Denied', 'NotAllowedError');
      },
    }),
  );
  await desk(page);
  await demo(page);
  await choose(page, '^Claude Desktop');
  await page.locator('#transfer-btn').click();
  await expect(page.locator('#status')).toContainText('Clipboard access was blocked');
  await expect(page.locator('#status')).not.toContainText('Copied');
  await expect(page.locator('#transfer-btn')).toBeEnabled();
});

test('a closed composer expires and cannot receive into a reopened window', async ({
  page,
  context,
}) => {
  const target = await composer(context, 'Closing composer');
  await desk(page);
  await demo(page);
  await choose(page, 'Closing composer');
  await target.close();
  const reopened = await composer(context, 'Closing composer');
  await page.waitForTimeout(16000);
  await page.locator('#transfer-btn').click();
  await expect(page.locator('#status')).toContainText('closed or reopened');
  await expect(reopened.locator('#editor')).toHaveValue('');
});

test('destination picker supports manual registration and has truthful source states', async ({
  page,
  context,
}) => {
  const first = await composer(context, 'Design workspace');
  const second = await composer(context, 'Design workspace');
  await desk(page);
  await demo(page);
  // Let closed windows from previous test contexts expire; the two live windows keep heartbeating.
  await page.waitForTimeout(16000);
  await page.locator('#target-picker').click();
  const firstID = (await first.locator('#window-identity').textContent()).replace('Window ', '');
  const secondID = (await second.locator('#window-identity').textContent()).replace('Window ', '');
  expect(firstID).not.toBe(secondID);
  await expect(page.locator('#target-dialog')).toContainText(`Design workspace · ${firstID}`);
  await expect(page.locator('#target-dialog')).toContainText(`Design workspace · ${secondID}`);
  await page.screenshot({ path: 'artifacts/05-destination-picker.png' });
  await page.getByText('Add another app', { exact: true }).click();
  await page.locator('#custom-name').fill('Unknown client');
  await page.locator('#register-btn').click();
  await expect(page.locator('#target-name')).toHaveText('Unknown client');
  await expect(page.locator('#transfer-label')).toHaveText('Copy for Unknown client');
  const model = demoConversation();
  model.verification = {
    status: 'partial',
    issues: [
      {
        code: 'unfinished-turn',
        message: 'This turn is still streaming. Wait for it to finish, then export again.',
      },
    ],
  };
  await importModel(page, model);
  await expect(page.locator('#source-issues')).toContainText('still streaming');
  await expect(page.locator('#transfer-btn')).toBeDisabled();
  await page.screenshot({ path: 'artifacts/06-incomplete-source.png' });
});

test('combined wire-size limit rejects before a request is staged', async ({ page, context }) => {
  await composer(context, 'Bounded composer');
  await desk(page);
  const model = demoConversation();
  model.turns[0].markdown = 'x'.repeat(3 * 1024 * 1024);
  await importModel(page, model);
  await page.locator('#attachment-files').setInputFiles([
    { name: 'one.txt', mimeType: 'text/plain', buffer: Buffer.alloc(5 * 1024 * 1024, 65) },
    { name: 'two.txt', mimeType: 'text/plain', buffer: Buffer.alloc(5 * 1024 * 1024, 66) },
  ]);
  await expect(page.locator('#status')).toContainText('2 files selected');
  await choose(page, 'Bounded composer');
  let staged = false;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/transfers') && request.method() === 'POST') staged = true;
  });
  await page.locator('#transfer-btn').click();
  await expect(page.locator('#status')).toContainText('16 MB transfer limit');
  expect(staged).toBe(false);
});

test('removing a mistaken source binding permits the correct file to be selected', async ({
  page,
}) => {
  await desk(page);
  const model = demoConversation();
  model.attachments = [
    {
      id: 'source-file',
      name: 'notes.md',
      sourceLocator: 'synthetic:file',
      status: 'download-needed',
    },
  ];
  await importModel(page, model);
  for (const [index, content] of ['mistaken', 'correct'].entries()) {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Select downloaded file for notes.md' }).click();
    await (
      await chooser
    ).setFiles({ name: 'notes.md', mimeType: '', buffer: Buffer.from(content) });
    await expect(page.locator('#status')).toContainText('file selected');
    if (index === 0) await page.getByRole('button', { name: 'Remove notes.md' }).click();
  }
  const download = page.waitForEvent('download');
  await page.locator('#save-btn').click();
  const saved = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(saved.attachments[0].sha256).toBe(createHash('sha256').update('correct').digest('hex'));
});
