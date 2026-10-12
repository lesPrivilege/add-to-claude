import test from 'node:test';
import assert from 'node:assert/strict';
import { createDownloadAssistance } from '../extension/downloads.js';
import { demoConversation, validateConversation } from '../src/model.js';

function fixture() {
  const model = demoConversation();
  model.source.type = 'dom-snapshot';
  model.source.url = 'https://chatgpt.com/c/download-fixture';
  model.attachments = [
    {
      id: 'file-1',
      name: 'report.csv',
      sourceLocator: 'turn:a/file:1',
      status: 'download-needed',
      url: 'https://example.org/report.csv',
    },
  ];
  const calls = { downloads: [], queries: [], cancels: [] };
  const state = {
    time: 10000,
    permission: true,
    item: {
      id: 42,
      state: 'complete',
      filename: '/private/local/folder/report (1).csv',
      fileSize: 12,
      bytesReceived: 12,
      totalBytes: 12,
      danger: 'safe',
    },
  };
  const chromeApi = {
    permissions: { contains: async () => state.permission },
    downloads: {
      download: async (options) => {
        calls.downloads.push(options);
        return 42;
      },
      search: async (query) => {
        calls.queries.push(query);
        return [state.item];
      },
      cancel: async (id) => {
        calls.cancels.push(id);
      },
    },
  };
  const service = createDownloadAssistance({
    chromeApi,
    inspect: async (identity) => identity,
    boundedModel: validateConversation,
    now: () => state.time,
  });
  const message = {
    model,
    identity: { tabId: 1, windowId: 1, url: model.source.url, documentId: 'document' },
    capturedAt: state.time,
    attachmentId: 'file-1',
  };
  return { service, chromeApi, calls, state, message };
}
test('download receipt binds only returned ID and never exposes local paths or claims available bytes', async () => {
  const f = fixture();
  const receipt = await f.service.start(f.message);
  assert.equal(receipt.status, 'pending');
  assert.equal(receipt.attachmentId, 'file-1');
  assert.deepEqual(f.calls.downloads, [
    {
      url: 'https://example.org/report.csv',
      filename: 'report.csv',
      saveAs: false,
      conflictAction: 'uniquify',
    },
  ]);
  const done = await f.service.status(receipt);
  assert.deepEqual(f.calls.queries, [{ id: 42 }]);
  assert.equal(done.status, 'complete');
  assert.equal(done.name, 'report (1).csv');
  assert.equal(done.size, 12);
  assert.equal(done.sourceLocator, 'turn:a/file:1');
  assert.equal(done.message.includes('Select this file'), true);
  assert.equal(JSON.stringify(done).includes('/private/'), false);
  assert.equal(done.sha256, undefined);
  assert.equal(done.browserId, undefined);
  assert.equal(f.message.model.attachments[0].status, 'download-needed');
});
test('downloads require selected source identity, permission and an exposed passive HTTPS file', async () => {
  for (const change of [
    (f) => {
      f.state.permission = false;
    },
    (f) => {
      f.message.identity.url = 'https://chatgpt.com/c/another';
    },
    (f) => {
      f.message.model.attachments[0].url = 'http://example.org/report.csv';
    },
    (f) => {
      f.message.model.attachments[0].name = 'run.exe';
    },
    (f) => {
      delete f.message.model.attachments[0].url;
    },
    (f) => {
      f.message.capturedAt = -1000000;
    },
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(f.service.start(f.message));
    assert.equal(f.calls.downloads.length, 0);
  }
});
test('duplicate simultaneous starts cannot produce two browser downloads', async () => {
  const f = fixture();
  const results = await Promise.allSettled([
    f.service.start(f.message),
    f.service.start(f.message),
  ]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(f.calls.downloads.length, 1);
});
test('terminal receipts free capacity while ten concurrent downloads remain bounded', async () => {
  const f = fixture();
  for (let index = 0; index < 12; index += 1) {
    const receipt = await f.service.start(f.message);
    assert.equal((await f.service.status(receipt)).status, 'complete');
  }
  for (let index = 0; index < 10; index += 1) {
    f.message.model.attachments[0].id = `active-${index}`;
    f.message.attachmentId = `active-${index}`;
    await f.service.start(f.message);
  }
  f.message.model.attachments[0].id = f.message.attachmentId = 'eleventh-active';
  await assert.rejects(f.service.start(f.message), /Ten downloads are in progress/);
  assert.equal(f.calls.downloads.length, 22);
});
test('browser search errors do not expose local paths', async () => {
  const f = fixture();
  const receipt = await f.service.start(f.message);
  f.chromeApi.downloads.search = async () => {
    throw new Error('/private/local/folder/report.csv');
  };
  await assert.rejects(f.service.status(receipt), {
    message: 'Chrome could not check this download. Open Chrome Downloads or retry.',
  });
});
test('late completion cannot overwrite a cancellation after an in-flight status query', async () => {
  const f = fixture();
  const receipt = await f.service.start(f.message);
  let resolve;
  f.chromeApi.downloads.search = () =>
    new Promise((r) => {
      resolve = r;
    });
  const waiting = f.service.status(receipt);
  await new Promise(setImmediate);
  await f.service.cancel(receipt);
  resolve([f.state.item]);
  assert.equal((await waiting).status, 'cancelled');
  assert.deepEqual(f.calls.cancels, [42]);
});
test('oversize and flagged downloads request cancellation without accepting browser warnings', async () => {
  for (const item of [
    { ...fixture().state.item, totalBytes: 6 * 1024 * 1024 },
    { ...fixture().state.item, danger: 'dangerous' },
  ]) {
    const f = fixture();
    f.state.item = item;
    const receipt = await f.service.start(f.message);
    assert.equal((await f.service.status(receipt)).status, 'cancelled');
    assert.deepEqual(f.calls.cancels, [42]);
  }
});
test('unknown or unsafe completed metadata is not forwarded as a file receipt', async () => {
  for (const item of [
    { ...fixture().state.item, fileSize: -1 },
    { ...fixture().state.item, filename: '/private/run.exe' },
  ]) {
    const f = fixture();
    f.state.item = item;
    const receipt = await f.service.start(f.message);
    const result = await f.service.status(receipt);
    assert.equal(result.status, 'interrupted');
    assert.equal(result.name, undefined);
  }
});
test('download metadata stays a selection hint and rejects absolute paths or excessive sizes', () => {
  const f = fixture();
  f.message.model.attachments[0].download = { name: 'report (1).csv', size: 12 };
  const model = validateConversation(f.message.model);
  assert.equal(model.attachments[0].status, 'download-needed');
  assert.deepEqual(model.attachments[0].download, { name: 'report (1).csv', size: 12 });
  for (const download of [
    { name: '/private/report.csv', size: 12 },
    { name: 'report.csv', size: 6 * 1024 * 1024 },
  ]) {
    f.message.model.attachments[0].download = download;
    assert.throws(() => validateConversation(f.message.model));
  }
});
