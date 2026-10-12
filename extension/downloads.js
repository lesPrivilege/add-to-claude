// Ordinary browser downloads only. This module never reads file bytes or browser history.
const MAX_FILE = 5 * 1024 * 1024;
const MAX_RECORDS = 10;
const LIFETIME = 5 * 60_000;
export const CAPTURE_MAX_AGE = 15 * 60_000;
const PASSIVE = /\.(?:txt|md|json|csv|pdf|png|jpe?g|webp)$/iu;
const safeName = (value) =>
  typeof value === 'string' &&
  value.length <= 180 &&
  !/[\\/\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/u.test(value) &&
  !/^\.{1,2}$/u.test(value) &&
  PASSIVE.test(value);

export function createDownloadAssistance({ chromeApi, inspect, boundedModel, now = Date.now }) {
  const records = new Map();
  const pendingKeys = new Set();
  const snapshot = (record) => ({
    attachmentId: record.attachmentId,
    sourceLocator: record.sourceLocator,
    receiptId: record.receiptId,
    status: record.status,
    ...(record.name ? { name: record.name } : {}),
    ...(Number.isSafeInteger(record.size) ? { size: record.size } : {}),
    ...(record.completedAt ? { completedAt: record.completedAt } : {}),
    message: record.message,
  });
  async function cancelRecord(
    record,
    message = 'Cancellation requested. Check Chrome Downloads before retrying.',
  ) {
    const pending = record.status === 'pending';
    record.status = 'cancelled';
    record.message = message;
    if (pending) await chromeApi.downloads.cancel(record.browserId).catch(() => {});
  }
  async function prune() {
    for (const [id, record] of records)
      if (now() - record.createdAt > LIFETIME) {
        await cancelRecord(
          record,
          'This download session expired. Use Chrome Downloads to inspect the file.',
        );
        records.delete(id);
      }
  }
  async function start(message) {
    await prune();
    const model = boundedModel(message.model);
    if (
      !Number.isSafeInteger(message.capturedAt) ||
      now() - message.capturedAt > CAPTURE_MAX_AGE ||
      message.capturedAt > now()
    )
      throw new Error('Capture the selected conversation again before downloading.');
    const identity = await inspect(message.identity);
    const selected = new URL(identity.url);
    if (
      model.source.type !== 'dom-snapshot' ||
      model.source.url !== selected.origin + selected.pathname
    )
      throw new Error('Select the captured conversation again.');
    const attachment = model.attachments.find((item) => item.id === message.attachmentId);
    if (!attachment || attachment.status !== 'download-needed' || !safeName(attachment.name))
      throw new Error(
        'Open this file in the source conversation and use its normal Download action.',
      );
    let url;
    try {
      url = new URL(attachment.url);
    } catch {}
    if (!url || url.protocol !== 'https:' || url.username || url.password)
      throw new Error(
        'Open the source conversation to download this file; no supported HTTPS download link is exposed.',
      );
    if (attachment.size > MAX_FILE)
      throw new Error('This file exceeds 5 MB. Download and attach it manually if needed.');
    if (!(await chromeApi.permissions.contains({ permissions: ['downloads'] })))
      throw new Error('Allow browser download assistance, then try again.');
    const key = `${identity.tabId}:${identity.documentId}:${attachment.id}`;
    if (
      pendingKeys.has(key) ||
      [...records.values()].some((item) => item.key === key && item.status === 'pending')
    )
      throw new Error('This file already has a download in progress.');
    while (records.size + pendingKeys.size >= MAX_RECORDS) {
      const terminal = [...records.values()].find((item) => item.status !== 'pending');
      if (!terminal)
        throw new Error('Ten downloads are in progress. Finish or cancel one before retrying.');
      records.delete(terminal.receiptId);
    }
    pendingKeys.add(key);
    try {
      // Pin the source once more after permission checks. No custom headers/body or credentials.
      await inspect(identity);
      const browserId = await chromeApi.downloads.download({
        url: url.href,
        filename: attachment.name,
        saveAs: false,
        conflictAction: 'uniquify',
      });
      if (!Number.isSafeInteger(browserId))
        throw new Error('Chrome did not start the download. Try its source Download action.');
      const receiptId = crypto.randomUUID().replaceAll('-', '');
      const record = {
        receiptId,
        browserId,
        key,
        attachmentId: attachment.id,
        sourceLocator: attachment.sourceLocator,
        status: 'pending',
        createdAt: now(),
        message: 'Downloading through Chrome…',
      };
      records.set(receiptId, record);
      return snapshot(record);
    } catch {
      throw new Error(
        'Chrome did not start the download. Check its download dialog or use the source Download action.',
      );
    } finally {
      pendingKeys.delete(key);
    }
  }
  async function status(message) {
    await prune();
    const record = records.get(message.receiptId);
    if (!record)
      throw new Error('This download session is no longer available. Check Chrome Downloads.');
    if (record.status !== 'pending') return snapshot(record);
    // Query only the exact ID returned by this session's download() call.
    let item;
    try {
      [item] = await chromeApi.downloads.search({ id: record.browserId });
    } catch {
      throw new Error('Chrome could not check this download. Open Chrome Downloads or retry.');
    }
    if (records.get(record.receiptId) !== record || record.status !== 'pending')
      return snapshot(record);
    if (!item || item.id !== record.browserId) {
      record.status = 'interrupted';
      record.message = 'The download is no longer reported by Chrome. Check Chrome Downloads.';
      return snapshot(record);
    }
    if (Math.max(item.bytesReceived || 0, item.totalBytes || 0, item.fileSize || 0) > MAX_FILE) {
      await cancelRecord(
        record,
        'Download exceeds 5 MB. Use the normal source download if needed.',
      );
      return snapshot(record);
    }
    if (item.danger && !['safe', 'deepScannedSafe'].includes(item.danger)) {
      await cancelRecord(
        record,
        'Chrome flagged this download. Review it in Chrome Downloads; no safety warning was accepted.',
      );
      return snapshot(record);
    }
    if (item.state === 'interrupted') {
      record.status = 'interrupted';
      record.message =
        'Download interrupted. Check Chrome Downloads, then retry or reopen the source.';
    } else if (item.state === 'complete') {
      const name = typeof item.filename === 'string' ? item.filename.split(/[\\/]/u).at(-1) : '';
      if (
        !safeName(name) ||
        !Number.isSafeInteger(item.fileSize) ||
        item.fileSize < 0 ||
        item.fileSize > MAX_FILE
      ) {
        record.status = 'interrupted';
        record.message =
          'Chrome completed a file with unsupported or unknown metadata. Select it manually in the desk.';
      } else {
        record.status = 'complete';
        record.name = name;
        record.size = item.fileSize;
        record.completedAt = new Date(now()).toISOString();
        record.message = 'Download complete. Select this file in the desk to include its bytes.';
      }
    }
    return snapshot(record);
  }
  async function cancel(message) {
    const record = records.get(message.receiptId);
    if (!record) throw new Error('This download session is no longer available.');
    if (record.status === 'pending') await cancelRecord(record);
    return snapshot(record);
  }
  return { start, status, cancel };
}
