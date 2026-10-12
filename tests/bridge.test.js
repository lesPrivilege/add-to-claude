import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createBridge, LIMITS, validateFiles } from '../src/bridge.js';
import { startServer } from '../src/server.js';

const INSTANCE = 'composer_instance_1234';
const FILE = {
  name: 'notes.md',
  type: 'text/markdown',
  base64: Buffer.from('# Synthetic notes\n').toString('base64'),
};
function registered(bridge, changes = {}) {
  return bridge.register({
    title: 'Synthetic composer',
    instance: INSTANCE,
    ready: true,
    revision: 0,
    hasDraft: false,
    ...changes,
  }).id;
}
function transfer(bridge, id, changes = {}) {
  return bridge.stage({
    targetId: id,
    targetInstance: INSTANCE,
    targetRevision: 0,
    mode: 'append',
    text: '# Synthetic fixture\n\n```js\nconst x = 1;\n```\n[Source](https://example.com)',
    files: [FILE],
    confirmed: true,
    ...changes,
  });
}
function failure(code) {
  return (error) => error.code === code;
}

test('transfer requires a verified claim and receipt, preserves bytes, and never discloses payload in status', () => {
  const bridge = createBridge();
  const id = registered(bridge);
  const staged = transfer(bridge, id);
  assert.equal(staged.status, 'pending');
  assert.deepEqual(Object.keys(bridge.targets().targets[0]).sort(), [
    'hasDraft',
    'id',
    'instance',
    'lastSeen',
    'ready',
    'revision',
    'title',
  ]);
  const payload = bridge.pending(id, INSTANCE).transfer;
  assert.equal(payload.files[0].base64, FILE.base64);
  assert.match(payload.text, /const x = 1/);
  assert.equal(bridge.status(staged.id).text, undefined);
  assert.throws(
    () => bridge.ack(staged.id, { instance: INSTANCE, status: 'inserted', revision: 1 }),
    failure('transfer_not_applying'),
  );
  const claim = bridge.claim(staged.id, { instance: INSTANCE, revision: 0 });
  assert.equal(claim.status, 'applying');
  assert.equal(bridge.pending(id, INSTANCE).transfer, null);
  assert.throws(() => bridge.cancel(staged.id), failure('cannot_cancel'));
  assert.throws(
    () =>
      bridge.ack(staged.id, {
        instance: INSTANCE,
        claimToken: 'wrong',
        status: 'inserted',
        revision: 1,
      }),
    failure('identity_mismatch'),
  );
  assert.throws(
    () =>
      bridge.ack(staged.id, {
        instance: INSTANCE,
        claimToken: claim.claimToken,
        status: 'inserted',
        revision: 0,
      }),
    failure('unverified_receipt'),
  );
  assert.equal(
    bridge.ack(staged.id, {
      instance: INSTANCE,
      claimToken: claim.claimToken,
      status: 'inserted',
      revision: 1,
    }).status,
    'inserted',
  );
  assert.equal(bridge.targets().targets[0].revision, 1);
  assert.equal(bridge.status(staged.id).claimToken, undefined);
  assert.throws(
    () =>
      bridge.ack(staged.id, {
        instance: INSTANCE,
        claimToken: claim.claimToken,
        status: 'inserted',
        revision: 1,
      }),
    failure('transfer_not_applying'),
  );
});

test('identity, readiness, draft revision, duplicate transfers, and explicit confirmation are mandatory', () => {
  const bridge = createBridge();
  const id = registered(bridge);
  assert.throws(
    () => registered(bridge, { id, instance: 'another_instance_1234' }),
    failure('identity_mismatch'),
  );
  assert.throws(
    () => transfer(bridge, id, { targetInstance: 'another_instance_1234' }),
    failure('target_unavailable'),
  );
  assert.throws(() => transfer(bridge, id, { targetRevision: 1 }), failure('draft_changed'));
  assert.throws(() => transfer(bridge, id, { confirmed: false }), failure('confirmation_required'));
  assert.throws(() => transfer(bridge, id, { mode: 'send' }), failure('invalid_mode'));
  const staged = transfer(bridge, id);
  assert.throws(() => transfer(bridge, id), failure('target_busy'));
  assert.throws(
    () => bridge.claim(staged.id, { instance: 'another_instance_1234', revision: 0 }),
    failure('identity_mismatch'),
  );
  assert.throws(() => bridge.pending(id, 'another_instance_1234'), failure('target_unavailable'));
  registered(bridge, { id, revision: 1, hasDraft: true });
  assert.equal(bridge.status(staged.id).status, 'failed');
  assert.equal(bridge.pending(id, INSTANCE).transfer, null);
  assert.throws(() => registered(bridge, { id, revision: 0 }), failure('stale_revision'));
  registered(bridge, { id, revision: 1, ready: false });
  assert.throws(() => transfer(bridge, id, { targetRevision: 1 }), failure('target_not_ready'));
});

test('cancellation revokes delivery and claims, while failed receipts return fixed safe errors', () => {
  const bridge = createBridge();
  const id = registered(bridge);
  const staged = transfer(bridge, id);
  assert.equal(bridge.cancel(staged.id).status, 'cancelled');
  assert.equal(bridge.cancel(staged.id).status, 'cancelled');
  assert.equal(bridge.pending(id, INSTANCE).transfer, null);
  assert.throws(
    () => bridge.claim(staged.id, { instance: INSTANCE, revision: 0 }),
    failure('transfer_not_pending'),
  );
  const retried = transfer(bridge, id);
  const claim = bridge.claim(retried.id, { instance: INSTANCE, revision: 0 });
  const receipt = bridge.ack(retried.id, {
    instance: INSTANCE,
    claimToken: claim.claimToken,
    status: 'failed',
    revision: 0,
    error: 'PRIVATE DRAFT CONTENT',
  });
  assert.equal(receipt.status, 'failed');
  assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE/);
});

test('target disappearance and transfer lease expiry clear deliverable content and reject late receipts', () => {
  let time = 1000;
  const bridge = createBridge({ now: () => time });
  const id = registered(bridge);
  const pending = transfer(bridge, id);
  time += LIMITS.heartbeatMs;
  assert.equal(bridge.targets().targets.length, 0);
  assert.equal(bridge.status(pending.id).status, 'expired');
  assert.throws(() => bridge.pending(id, INSTANCE), failure('target_unavailable'));
  registered(bridge, { id });
  const applying = transfer(bridge, id);
  const claim = bridge.claim(applying.id, { instance: INSTANCE, revision: 0 });
  time += 14_000;
  registered(bridge, { id });
  time += 14_000;
  registered(bridge, { id });
  time += 2000;
  assert.equal(bridge.status(applying.id).status, 'expired');
  assert.match(bridge.status(applying.id).error, /Check the selected composer/);
  assert.throws(
    () =>
      bridge.ack(applying.id, {
        instance: INSTANCE,
        claimToken: claim.claimToken,
        status: 'inserted',
        revision: 1,
      }),
    failure('transfer_not_applying'),
  );
});

test('registry and transfer counts remain bounded, reclaiming terminal receipts for retries', () => {
  const bridge = createBridge();
  const ids = [];
  for (let i = 0; i < LIMITS.targets; i += 1)
    ids.push(registered(bridge, { instance: `instance_${i}_synthetic` }));
  assert.throws(() => registered(bridge), failure('too_many_targets'));
  const transfers = ids.map((id, i) =>
    transfer(bridge, id, { targetInstance: `instance_${i}_synthetic` }),
  );
  bridge.cancel(transfers[0].id);
  const next = transfer(bridge, ids[0], { targetInstance: 'instance_0_synthetic' });
  assert.equal(next.status, 'pending');
  assert.throws(() => bridge.status(transfers[0].id), failure('transfer_missing'));
});

test('attachment validation rejects traversal, executables, disguised MIME, malformed base64 and duplicates', () => {
  for (const name of [
    '../notes.md',
    'a/b.txt',
    'a\\b.txt',
    '.hidden.txt',
    'nul.txt',
    'notes.txt ',
    'x\u202etxt.md',
  ]) {
    assert.throws(() => validateFiles([{ ...FILE, name }]), failure('unsafe_filename'));
  }
  for (const name of ['index.html', 'image.svg', 'script.js', 'run.sh', 'code.py', 'program.exe']) {
    assert.throws(() => validateFiles([{ ...FILE, name }]), failure('unsupported_file'));
  }
  assert.throws(() => validateFiles([{ ...FILE, type: 'text/html' }]), failure('unsupported_file'));
  for (const base64 of ['@@@@', 'a===', 'abc', 'a b=', 'AB==']) {
    assert.throws(() => validateFiles([{ ...FILE, base64 }]), failure('invalid_file_data'));
  }
  assert.throws(
    () => validateFiles([FILE, { ...FILE, name: 'NOTES.MD' }]),
    failure('duplicate_file'),
  );
  assert.throws(
    () => validateFiles(Array.from({ length: 11 }, () => FILE)),
    failure('invalid_files'),
  );
  assert.deepEqual(validateFiles([FILE]), [FILE]);
});

test('large payload bounds apply to UTF-8 bytes and decoded files, including valid 5 MiB attachments', () => {
  const bridge = createBridge();
  const id = registered(bridge);
  assert.throws(
    () => transfer(bridge, id, { text: 'x'.repeat(LIMITS.textBytes + 1) }),
    failure('text_too_large'),
  );
  assert.throws(
    () => transfer(bridge, id, { text: '🙂'.repeat(LIMITS.textBytes / 4 + 1) }),
    failure('text_too_large'),
  );
  const large = {
    name: 'large.txt',
    type: 'text/plain',
    base64: Buffer.alloc(LIMITS.fileBytes).toString('base64'),
  };
  assert.equal(validateFiles([large])[0].base64.length, large.base64.length);
  assert.throws(
    () =>
      validateFiles([{ ...large, base64: Buffer.alloc(LIMITS.fileBytes + 1).toString('base64') }]),
    failure('invalid_file_data'),
  );
  assert.throws(
    () => validateFiles([large, { ...large, name: 'second.txt' }, FILE]),
    failure('files_too_large'),
  );
});

let running;
let temp;
let token;
before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'add-it-bridge-test-'));
  await mkdir(path.join(temp, 'web'));
  await mkdir(path.join(temp, 'src'));
  await writeFile(
    path.join(temp, 'web/index.html'),
    '<!doctype html><title>Synthetic fixture</title>',
  );
  await writeFile(path.join(temp, 'src/model.js'), 'export const synthetic = true;');
  await writeFile(path.join(temp, 'secret.txt'), 'PRIVATE-SENTINEL');
  running = await startServer({ port: 0, root: temp, nativeInstance: 'synthetic_native_instance' });
  const response = await fetch(`${running.origin}/api/session`, {
    headers: { 'X-Add-It-Client': 'desk' },
  });
  assert.equal(response.status, 200);
  token = (await response.json()).token;
});
after(async () => {
  await running?.close();
  if (temp) await rm(temp, { recursive: true, force: true });
});
async function request(route, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${running.origin}${route}`, {
    method,
    headers: {
      'X-Add-It-Token': token,
      ...(method === 'GET' ? {} : { Origin: running.origin, 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  return { response, body: await response.json() };
}
function rawRequest(route, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(running.origin);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: route, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

test('HTTP rejects DNS rebinding, cross-origin reads/writes, missing tokens and cross-site session acquisition', async () => {
  const health = await request('/health');
  assert.deepEqual(health.body, {
    app: 'gpt-handoff',
    protocol: 1,
    nativeInstance: 'synthetic_native_instance',
  });
  assert.equal(
    (await rawRequest('/health', { headers: { Host: 'attacker.example' } })).status,
    403,
  );
  assert.equal(
    (await request('/api/targets', { headers: { Origin: 'https://attacker.example' } })).response
      .status,
    403,
  );
  assert.equal(
    (await request('/api/targets', { headers: { 'X-Add-It-Token': '' } })).response.status,
    403,
  );
  assert.equal((await request('/api/session')).response.status, 403);
  assert.equal(
    (
      await request('/api/session', {
        headers: { 'X-Add-It-Client': 'desk', 'Sec-Fetch-Site': 'cross-site' },
      })
    ).response.status,
    403,
  );
  assert.equal(
    (
      await request('/api/session', {
        headers: { 'X-Add-It-Client': 'desk', 'Sec-Fetch-Site': 'none' },
      })
    ).response.status,
    403,
  );
  assert.equal(
    (
      await request('/api/session', {
        headers: { 'X-Add-It-Client': 'desk', 'Sec-Fetch-Site': 'same-origin' },
      })
    ).response.status,
    200,
  );
  const missingOrigin = await rawRequest('/api/composers', {
    method: 'POST',
    headers: { 'X-Add-It-Token': token, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(missingOrigin.status, 403);
  assert.equal(
    (await request('/api/composers', { method: 'POST', body: {}, headers: { Origin: 'null' } }))
      .response.status,
    403,
  );
  assert.equal((await request('/api/targets', { method: 'OPTIONS' })).response.status, 404);
  assert.equal(health.response.headers.get('access-control-allow-origin'), null);
});

test('static files are exact allowlisted with strict browser headers and no path traversal', async () => {
  const index = await fetch(running.origin);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /Synthetic fixture/);
  assert.match(index.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(index.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(index.headers.get('cache-control'), 'no-store');
  assert.equal(index.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(index.headers.get('x-frame-options'), 'DENY');
  assert.equal((await fetch(`${running.origin}/src/model.js`)).status, 200);
  for (const route of [
    '/secret.txt',
    '/src/server.js',
    '/src/bridge.js',
    '/.git/config',
    '/src/../secret.txt',
    '/%2e%2e/secret.txt',
    '/src%2fmodel.js',
    '//src/model.js',
    '/src\\model.js',
  ]) {
    const response = await rawRequest(route);
    assert.equal(response.status, 404, route);
    assert.doesNotMatch(response.body, /PRIVATE-SENTINEL/);
  }
});

test('HTTP validates JSON content type, syntax, byte bounds and consumes chunked oversize safely', async () => {
  assert.equal(
    (
      await request('/api/composers', {
        method: 'POST',
        body: '{}',
        headers: { 'Content-Type': 'text/plain' },
      })
    ).response.status,
    415,
  );
  assert.equal(
    (await request('/api/composers', { method: 'POST', body: '{' })).response.status,
    400,
  );
  const tooLarge = await rawRequest('/api/composers', {
    method: 'POST',
    headers: {
      Origin: running.origin,
      'X-Add-It-Token': token,
      'Content-Type': 'application/json',
      'Content-Length': String(LIMITS.jsonBytes + 1),
    },
  });
  assert.equal(tooLarge.status, 413);
  const chunked = await rawRequest('/api/composers', {
    method: 'POST',
    headers: {
      Origin: running.origin,
      'X-Add-It-Token': token,
      'Content-Type': 'application/json',
      'Transfer-Encoding': 'chunked',
    },
    body: ' '.repeat(LIMITS.jsonBytes + 1),
  });
  assert.equal(chunked.status, 413);
  assert.equal((await request('/health')).response.status, 200);
});

test('real HTTP transfer confirms insertion only after a matching verified receipt', async () => {
  const registeredResponse = await request('/api/composers', {
    method: 'POST',
    body: {
      title: 'HTTP synthetic composer',
      instance: INSTANCE,
      ready: true,
      revision: 0,
      hasDraft: true,
    },
  });
  assert.equal(registeredResponse.response.status, 200);
  const targetId = registeredResponse.body.id;
  const staged = await request('/api/transfers', {
    method: 'POST',
    body: {
      targetId,
      targetInstance: INSTANCE,
      targetRevision: 0,
      mode: 'append',
      text: '# Public synthetic example',
      files: [FILE],
      confirmed: true,
    },
  });
  assert.equal(staged.response.status, 201);
  assert.equal(staged.body.status, 'pending');
  const id = staged.body.id;
  assert.equal(
    (await request(`/api/composers/${targetId}/pending?instance=${INSTANCE}`)).body.transfer.text,
    '# Public synthetic example',
  );
  const claim = await request(`/api/transfers/${id}/claim`, {
    method: 'POST',
    body: { instance: INSTANCE, revision: 0 },
  });
  assert.equal(claim.body.status, 'applying');
  assert.equal((await request(`/api/transfers/${id}`, { method: 'DELETE' })).response.status, 409);
  const ack = await request(`/api/transfers/${id}/ack`, {
    method: 'POST',
    body: {
      instance: INSTANCE,
      claimToken: claim.body.claimToken,
      status: 'inserted',
      revision: 1,
    },
  });
  assert.equal(ack.body.status, 'inserted');
  const status = await request(`/api/transfers/${id}`);
  assert.equal(status.body.status, 'inserted');
  assert.equal(status.body.text, undefined);
  assert.equal(status.body.files, undefined);
  assert.equal(
    (await request(`/api/composers/${targetId}/pending?instance=${INSTANCE}`)).body.transfer,
    null,
  );
});
