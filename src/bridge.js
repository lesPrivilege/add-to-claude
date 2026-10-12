import { randomUUID } from 'node:crypto';

export const LIMITS = Object.freeze({
  jsonBytes: 16 * 1024 * 1024,
  textBytes: 8 * 1024 * 1024,
  fileBytes: 5 * 1024 * 1024,
  totalFileBytes: 10 * 1024 * 1024,
  files: 10,
  targets: 32,
  transfers: 32,
  heartbeatMs: 15_000,
  transferMs: 30_000,
});

const PASSIVE_TYPES = new Map([
  ['txt', ['text/plain']],
  ['md', ['text/markdown', 'text/plain']],
  ['json', ['application/json', 'text/plain']],
  ['csv', ['text/csv', 'text/plain']],
  ['pdf', ['application/pdf']],
  ['png', ['image/png']],
  ['jpg', ['image/jpeg']],
  ['jpeg', ['image/jpeg']],
  ['webp', ['image/webp']],
]);
const ACTIVE = new Set(['pending', 'applying']);
const IDENTIFIER = /^[a-zA-Z0-9_-]{8,128}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

export class BridgeError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function fail(status, code, message) {
  throw new BridgeError(status, code, message);
}

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(400, 'invalid_body', 'Provide a JSON object.');
  }
  return value;
}

function identifier(value, label) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    fail(400, 'invalid_identity', `Provide a valid ${label}.`);
  }
  return value;
}

function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(400, 'invalid_revision', 'Provide the current composer revision.');
  }
  return value;
}

function boolean(value, label) {
  if (typeof value !== 'boolean') fail(400, 'invalid_value', `Provide ${label}.`);
  return value;
}

function cleanError(value) {
  // The caller may accidentally include a draft in an error. Return fixed errors only.
  const allowed = new Map([
    ['not_ready', 'Focus the selected composer and retry.'],
    ['target_changed', 'The selected composer changed. Select it again.'],
    ['draft_changed', 'The composer draft changed. Review it and retry.'],
    ['write_failed', 'The composer could not confirm insertion. Check its draft before retrying.'],
    [
      'files_failed',
      'The composer could not confirm the attachments. Check its draft before retrying.',
    ],
  ]);
  return (
    allowed.get(value) ||
    'Insertion was not confirmed. Check the selected composer before retrying.'
  );
}

export function validateFiles(files) {
  if (!Array.isArray(files) || files.length > LIMITS.files) {
    fail(400, 'invalid_files', `Choose at most ${LIMITS.files} attachments.`);
  }
  let total = 0;
  const names = new Set();
  return files.map((file) => {
    object(file);
    const { name, type, base64 } = file;
    if (
      typeof name !== 'string' ||
      name.length < 1 ||
      Buffer.byteLength(name) > 180 ||
      name !== name.normalize('NFC') ||
      /[\\/:*?"<>|]/.test(name) ||
      CONTROL.test(name) ||
      /[\u202a-\u202e\u2066-\u2069]/.test(name) ||
      name.startsWith('.') ||
      /[. ]$/.test(name) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
    ) {
      fail(
        400,
        'unsafe_filename',
        'Use a simple attachment filename without paths or control characters.',
      );
    }
    const extension = name.split('.').at(-1).toLowerCase();
    if (!name.includes('.') || !PASSIVE_TYPES.get(extension)?.includes(type)) {
      fail(
        400,
        'unsupported_file',
        'Choose TXT, Markdown, JSON, CSV, PDF, PNG, JPEG, or WebP files.',
      );
    }
    const folded = name.toLowerCase();
    if (names.has(folded)) fail(400, 'duplicate_file', 'Give each attachment a distinct filename.');
    names.add(folded);
    if (
      typeof base64 !== 'string' ||
      base64.length > Math.ceil(LIMITS.fileBytes / 3) * 4 ||
      base64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
    ) {
      fail(400, 'invalid_file_data', 'Use a valid attachment no larger than 5 MiB.');
    }
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length > LIMITS.fileBytes || bytes.toString('base64') !== base64) {
      fail(400, 'invalid_file_data', 'Use a valid attachment no larger than 5 MiB.');
    }
    total += bytes.length;
    if (total > LIMITS.totalFileBytes)
      fail(413, 'files_too_large', 'Choose attachments totaling at most 10 MiB.');
    // Opaque data only: neither this bridge nor the harness opens or executes attachments.
    return { name, type, base64 };
  });
}

/** In-memory single-user bridge. Targets disclose identity/readiness only, never draft text.
 * Transfers move pending -> applying after a claim -> inserted/failed after a receipt.
 * Only pending transfers can be cancelled. A missing receipt never means insertion succeeded.
 */
export function createBridge({ now = Date.now, uuid = randomUUID } = {}) {
  const targets = new Map();
  const transfers = new Map();

  function finish(transfer, status, error) {
    transfer.status = status;
    transfer.updatedAt = now();
    if (error) transfer.error = error;
    delete transfer.text;
    delete transfer.files;
    delete transfer.claimToken;
  }

  function prune() {
    const time = now();
    for (const [id, target] of targets) {
      if (time - target.lastSeen >= LIMITS.heartbeatMs) targets.delete(id);
    }
    for (const transfer of transfers.values()) {
      if (!ACTIVE.has(transfer.status)) continue;
      if (time >= transfer.expiresAt || !targets.has(transfer.targetId)) {
        finish(
          transfer,
          'expired',
          transfer.status === 'applying'
            ? 'The insertion receipt expired. Check the selected composer before retrying.'
            : 'The selected composer or transfer expired. Open the composer and retry.',
        );
      }
    }
  }

  function targetFor(id, instance) {
    identifier(id, 'target identity');
    identifier(instance, 'composer instance');
    const target = targets.get(id);
    if (!target || target.instance !== instance) {
      fail(
        409,
        'target_unavailable',
        'The selected composer is no longer available. Select it again.',
      );
    }
    return target;
  }

  function transferFor(id) {
    identifier(id, 'transfer identity');
    const transfer = transfers.get(id);
    if (!transfer) fail(404, 'transfer_missing', 'This transfer is no longer available.');
    return transfer;
  }

  function statusOf(transfer) {
    return {
      id: transfer.id,
      status: transfer.status,
      expiresAt: transfer.expiresAt,
      ...(transfer.error ? { error: transfer.error } : {}),
    };
  }

  function roomForTransfer() {
    if (transfers.size < LIMITS.transfers) return;
    for (const [id, transfer] of transfers) {
      if (!ACTIVE.has(transfer.status)) {
        transfers.delete(id);
        return;
      }
    }
    fail(429, 'too_many_transfers', 'Finish or cancel a pending transfer and retry.');
  }

  return {
    prune,
    register(body) {
      prune();
      object(body);
      const instance = identifier(body.instance, 'composer instance');
      if (
        typeof body.title !== 'string' ||
        !body.title.trim() ||
        body.title.length > 160 ||
        CONTROL.test(body.title)
      ) {
        fail(400, 'invalid_title', 'Use a composer title of 1–160 characters.');
      }
      const ready = boolean(body.ready, 'composer readiness');
      const hasDraft = boolean(body.hasDraft, 'draft presence');
      const currentRevision = revision(body.revision);
      let id = body.id === undefined ? undefined : identifier(body.id, 'composer identity');
      const sameInstance = [...targets.values()].find((entry) => entry.instance === instance);
      if (!id && sameInstance) id = sameInstance.id;
      if (id && sameInstance && sameInstance.id !== id)
        fail(409, 'instance_registered', 'This composer instance is already registered.');
      id ||= uuid();
      const previous = targets.get(id);
      if (previous && previous.instance !== instance)
        fail(409, 'identity_mismatch', 'This window identity belongs to another composer.');
      if (previous && currentRevision < previous.revision)
        fail(409, 'stale_revision', 'Refresh the composer revision and retry.');
      if (!previous && targets.size >= LIMITS.targets)
        fail(429, 'too_many_targets', 'Close an unused test composer and retry.');
      targets.set(id, {
        id,
        title: body.title.trim(),
        instance,
        ready,
        revision: currentRevision,
        hasDraft,
        lastSeen: now(),
      });
      for (const transfer of transfers.values()) {
        if (transfer.targetId !== id || transfer.status !== 'pending') continue;
        if (!ready || currentRevision !== transfer.targetRevision) {
          finish(
            transfer,
            'failed',
            !ready
              ? 'The selected composer is not ready. Focus it and retry.'
              : 'The composer draft changed. Review it and retry.',
          );
        }
      }
      return { id };
    },
    targets() {
      prune();
      return { targets: [...targets.values()].map((entry) => ({ ...entry })) };
    },
    stage(body) {
      prune();
      object(body);
      if (body.confirmed !== true)
        fail(400, 'confirmation_required', 'Confirm the selected composer before adding content.');
      const target = targetFor(body.targetId, body.targetInstance);
      const targetRevision = revision(body.targetRevision);
      if (!target.ready) fail(409, 'target_not_ready', 'Focus the selected composer and retry.');
      if (target.revision !== targetRevision)
        fail(409, 'draft_changed', 'The composer draft changed. Review it and retry.');
      if (body.mode !== 'append' && body.mode !== 'replace')
        fail(400, 'invalid_mode', 'Choose append or replace for the composer draft.');
      if (
        typeof body.text !== 'string' ||
        Buffer.byteLength(body.text, 'utf8') > LIMITS.textBytes
      ) {
        fail(413, 'text_too_large', 'Choose text no larger than 8 MiB.');
      }
      const files = validateFiles(body.files);
      if (!body.text.length && !files.length)
        fail(400, 'empty_transfer', 'Choose conversation text or an attachment to add.');
      if (
        [...transfers.values()].some(
          (item) => item.targetId === target.id && ACTIVE.has(item.status),
        )
      ) {
        fail(409, 'target_busy', 'Wait for the current transfer or cancel it before trying again.');
      }
      roomForTransfer();
      const transfer = {
        id: uuid(),
        targetId: target.id,
        targetInstance: target.instance,
        targetRevision,
        mode: body.mode,
        text: body.text,
        files,
        status: 'pending',
        createdAt: now(),
        updatedAt: now(),
        expiresAt: now() + LIMITS.transferMs,
      };
      transfers.set(transfer.id, transfer);
      return statusOf(transfer);
    },
    pending(id, instance) {
      prune();
      targetFor(id, instance);
      const transfer = [...transfers.values()].find(
        (item) =>
          item.targetId === id && item.targetInstance === instance && item.status === 'pending',
      );
      return {
        transfer: transfer
          ? {
              id: transfer.id,
              targetId: transfer.targetId,
              targetInstance: transfer.targetInstance,
              targetRevision: transfer.targetRevision,
              mode: transfer.mode,
              text: transfer.text,
              files: transfer.files.map((file) => ({ ...file })),
              expiresAt: transfer.expiresAt,
            }
          : null,
      };
    },
    claim(id, body) {
      prune();
      object(body);
      const transfer = transferFor(id);
      if (transfer.targetInstance !== body.instance)
        fail(409, 'identity_mismatch', 'The selected composer changed. Select it again.');
      if (transfer.status !== 'pending')
        fail(409, 'transfer_not_pending', 'This transfer is no longer waiting for insertion.');
      const target = targetFor(transfer.targetId, body.instance);
      if (
        !target.ready ||
        target.revision !== revision(body.revision) ||
        target.revision !== transfer.targetRevision
      ) {
        finish(transfer, 'failed', 'The composer changed before insertion. Review it and retry.');
        fail(409, 'draft_changed', 'The composer changed before insertion. Review it and retry.');
      }
      transfer.status = 'applying';
      transfer.updatedAt = now();
      transfer.claimToken = uuid();
      // The composer already has the payload. Do not retain another server copy during insertion.
      delete transfer.text;
      delete transfer.files;
      return { ...statusOf(transfer), claimToken: transfer.claimToken };
    },
    ack(id, body) {
      prune();
      object(body);
      const transfer = transferFor(id);
      if (transfer.status !== 'applying')
        fail(409, 'transfer_not_applying', 'This transfer cannot accept an insertion receipt.');
      if (transfer.targetInstance !== body.instance || transfer.claimToken !== body.claimToken) {
        fail(
          409,
          'identity_mismatch',
          'The insertion receipt does not match the selected composer.',
        );
      }
      if (body.status !== 'inserted' && body.status !== 'failed')
        fail(400, 'invalid_receipt', 'Confirm insertion or report a failed write.');
      const currentRevision = revision(body.revision);
      if (body.status === 'inserted' && currentRevision <= transfer.targetRevision) {
        fail(409, 'unverified_receipt', 'Confirm the changed composer before reporting insertion.');
      }
      const target = targetFor(transfer.targetId, body.instance);
      if (body.status === 'inserted') {
        target.revision = Math.max(target.revision, currentRevision);
        target.hasDraft = true;
      }
      finish(transfer, body.status, body.status === 'failed' ? cleanError(body.error) : undefined);
      return statusOf(transfer);
    },
    status(id) {
      prune();
      return statusOf(transferFor(id));
    },
    cancel(id) {
      prune();
      const transfer = transferFor(id);
      if (transfer.status === 'cancelled') return statusOf(transfer);
      if (transfer.status !== 'pending') {
        fail(
          409,
          'cannot_cancel',
          'Insertion has started or finished. Check the selected composer.',
        );
      }
      finish(transfer, 'cancelled');
      return statusOf(transfer);
    },
    close() {
      for (const transfer of transfers.values()) finish(transfer, 'expired');
      targets.clear();
      transfers.clear();
    },
  };
}
