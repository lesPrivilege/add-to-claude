import { validateConversation } from './model.js';

/** Fatal stops never authorize automatic delivery of .partial. It is the last consistent observation. */
export class CollectionError extends Error {
  constructor(code, message, partial) {
    super(message);
    this.name = 'CollectionError';
    this.code = code;
    if (partial) this.partial = partial;
  }
}

/** Explicit, bounded scrolling of one pinned document through an injected driver; no network or history API. */
export async function collectConversation(driver, options = {}) {
  for (const method of ['snapshot', 'viewport', 'scroll', 'restore'])
    if (typeof driver?.[method] !== 'function')
      throw new TypeError(`Collection driver requires ${method}().`);
  const bounded = (value, fallback, min, max) =>
    Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  const limits = {
    duration: bounded(options.maxDurationMs, 90000, 100, 90000),
    steps: Math.floor(bounded(options.maxSteps, 200, 1, 200)),
    turns: Math.floor(bounded(options.maxTurns, 5000, 1, 5000)),
    bytes: Math.floor(bounded(options.maxBytes, 8 * 1024 * 1024, 1024, 8 * 1024 * 1024)),
    settle: bounded(options.settleMs, 250, 25, 1000),
    boundary: bounded(options.boundaryHoldMs, 1500, 100, 5000),
    samples: Math.floor(bounded(options.boundarySamples, 3, 2, 10)),
    stall: bounded(options.stallMs, 6000, 300, 15000),
  };
  const started = Date.now();
  const deadline = started + limits.duration;
  const encoder = new TextEncoder();
  let phase = 'starting',
    steps = 0,
    snapshots = 0,
    startObserved = false,
    endObserved = false;
  let origin,
    base,
    lastCapture,
    reportedTotal,
    restoredScroll = false,
    reason = 'capture-error';
  const captureEvidence = {
    hiddenTurns: 0,
    branchControls: false,
    streaming: false,
    truncated: false,
  };
  let fatal, result;
  let ordered = [],
    records = new Map(),
    edges = new Map(),
    signatures = new Map(),
    files = new Map();
  const issues = new Map();
  const addIssue = (item) => {
    if (issues.size < 1000)
      issues.set(`${item.code}\u0000${item.sourceLocator ?? ''}\u0000${item.message}`, item);
  };
  const progress = () =>
    options.onProgress?.({
      phase,
      observedTurns: ordered.length,
      steps,
      elapsedMs: Date.now() - started,
      startObserved,
      endObserved,
      ...(phase === 'done' ? { stoppedReason: reason } : {}),
    });
  const stop = (code, message) => {
    throw new CollectionError(code, message);
  };
  const check = () => {
    if (options.signal?.aborted)
      stop('cancelled', 'Collection cancelled. No conversation was delivered.');
    if (Date.now() >= deadline) stop('duration-limit', 'Collection reached its time limit.');
  };
  const call = async (operation) => {
    check();
    let timer, abort;
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          check();
          return operation();
        }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new CollectionError('duration-limit', 'Collection reached its time limit.')),
            Math.max(1, deadline - Date.now()),
          );
          abort = () =>
            reject(
              new CollectionError(
                'cancelled',
                'Collection cancelled. No conversation was delivered.',
              ),
            );
          options.signal?.addEventListener('abort', abort, { once: true });
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (abort) options.signal?.removeEventListener('abort', abort);
    }
  };
  const pause = () => call(() => new Promise((resolve) => setTimeout(resolve, limits.settle)));
  const inspect = async (begin = false) => {
    const viewport = await call(() => driver.viewport(begin ? { begin: true } : {}));
    if (
      !viewport ||
      typeof viewport.identity !== 'string' ||
      typeof viewport.url !== 'string' ||
      ![viewport.scrollTop, viewport.scrollHeight, viewport.clientHeight].every(Number.isFinite)
    )
      stop('capture-error', 'The page did not provide a valid conversation viewport.');
    if (origin && (viewport.url !== origin.url || viewport.identity !== origin.identity))
      stop('navigation', 'The selected conversation or its scroll area changed.');
    if (viewport.userIntervened)
      stop('user-intervened', 'Collection stopped because you took control of the page.');
    return viewport;
  };
  const sourceKey = (snapshot) => `${snapshot.source.id}\u0000${snapshot.source.url}`;
  const fileSignature = (attachment) =>
    JSON.stringify({
      name: attachment.name,
      url: attachment.url,
      status: attachment.status,
      sourceLocator: attachment.sourceLocator,
      mediaType: attachment.mediaType,
      size: attachment.size,
    });
  const turnSignature = (turn, snapshot) =>
    JSON.stringify({
      role: turn.role,
      markdown: turn.markdown,
      renderedIndex: turn.renderedIndex,
      code: turn.code,
      citations: turn.citations.map(({ url, title }) => ({ url, title })),
      files: snapshot.attachments
        .filter((file) => file.turnId === turn.id)
        .map(fileSignature)
        .sort(),
    });
  const merge = (snapshot) => {
    if (snapshot.source.type !== 'dom-snapshot')
      stop('capture-error', 'Collection accepts rendered conversation snapshots only.');
    const pinnedUrl = new URL(origin.url);
    if (snapshot.source.url !== `${pinnedUrl.origin}${pinnedUrl.pathname}`)
      stop(
        'navigation',
        'The rendered snapshot does not belong to the selected conversation page.',
      );
    if (base && sourceKey(snapshot) !== sourceKey(base))
      stop('navigation', 'The selected conversation changed during collection.');
    if (
      snapshot.source.capture?.streaming ||
      snapshot.verification.issues.some((item) => item.code === 'streaming')
    )
      stop('streaming', 'A response is generating. Wait for it to finish and collect again.');
    if (
      snapshot.turns.some((turn) => turn.sourceMessageId !== turn.id) ||
      snapshot.verification.issues.some((item) =>
        ['missing-message-id', 'duplicate-message-id'].includes(item.code),
      )
    )
      stop(
        'unstable-identity',
        'Stable message IDs are missing or duplicated. Use an explicit single snapshot or the conversation export.',
      );
    const nextRecords = new Map(records),
      nextSignatures = new Map(signatures),
      nextFiles = new Map(files);
    const nextEdges = new Map(Array.from(edges, ([id, following]) => [id, new Set(following)]));
    const ids = snapshot.turns.map((turn) => turn.id);
    if (records.size && !ids.some((id) => records.has(id)))
      stop(
        'disconnected',
        'The next rendered window does not overlap the collected turns. Order cannot be established safely; use the conversation export.',
      );
    for (const turn of snapshot.turns) {
      const signature = turnSignature(turn, snapshot);
      if (signatures.has(turn.id) && signatures.get(turn.id) !== signature)
        stop(
          'conflict',
          'An overlapping message changed content, source links, attachment state, or branch. Collect the selected branch again.',
        );
      nextRecords.set(turn.id, turn);
      nextSignatures.set(turn.id, signature);
      if (!nextEdges.has(turn.id)) nextEdges.set(turn.id, new Set());
    }
    for (let index = 1; index < ids.length; index += 1)
      nextEdges.get(ids[index - 1]).add(ids[index]);
    const indexed = Array.from(nextRecords.values())
      .filter((turn) => turn.renderedIndex !== undefined)
      .sort((a, b) => a.renderedIndex - b.renderedIndex);
    for (let index = 1; index < indexed.length; index += 1) {
      if (indexed[index].renderedIndex === indexed[index - 1].renderedIndex)
        stop(
          'conflict',
          'Different messages claim the same rendered position. The branch may have changed.',
        );
      nextEdges.get(indexed[index - 1].id).add(indexed[index].id);
    }
    const indegree = new Map(Array.from(nextRecords.keys(), (id) => [id, 0]));
    let edgeCount = 0;
    for (const following of nextEdges.values())
      for (const id of following) {
        indegree.set(id, indegree.get(id) + 1);
        edgeCount += 1;
      }
    if (edgeCount > 20000)
      stop(
        'conflict',
        'The observed order exceeds the bounded relationship limit. Use the conversation export.',
      );
    const available = Array.from(indegree)
      .filter(([, degree]) => !degree)
      .map(([id]) => id);
    const nextOrder = [];
    while (available.length) {
      if (available.length !== 1)
        stop(
          'disconnected',
          'Overlapping windows do not establish one unambiguous turn order. Use the conversation export.',
        );
      const id = available.pop();
      nextOrder.push(id);
      for (const following of nextEdges.get(id)) {
        indegree.set(following, indegree.get(following) - 1);
        if (!indegree.get(following)) available.push(following);
      }
    }
    if (nextOrder.length !== nextRecords.size)
      stop(
        'conflict',
        'Rendered windows contradict each other’s turn order. Collect the selected branch again.',
      );
    if (nextOrder.length > limits.turns) stop('turn-limit', 'Collection reached its turn limit.');
    for (const attachment of snapshot.attachments) {
      const key = `${attachment.turnId ?? ''}\u0000${attachment.sourceLocator}\u0000${attachment.name}`;
      if (!nextFiles.has(key))
        nextFiles.set(key, { ...attachment, id: `collected-file-${nextFiles.size + 1}` });
    }
    const size = encoder.encode(
      JSON.stringify({
        turns: nextOrder.map((id) => nextRecords.get(id)),
        attachments: [...nextFiles.values()],
      }),
    ).byteLength;
    if (size > limits.bytes - 512 || nextFiles.size > 1000)
      stop('byte-limit', 'Collection reached its payload limit.');
    records = nextRecords;
    signatures = nextSignatures;
    edges = nextEdges;
    ordered = nextOrder;
    files = nextFiles;
    base ??= snapshot;
    lastCapture = snapshot.source.capture;
    if (lastCapture) {
      captureEvidence.hiddenTurns = Math.max(captureEvidence.hiddenTurns, lastCapture.hiddenTurns);
      for (const flag of ['branchControls', 'streaming', 'truncated'])
        captureEvidence[flag] ||= lastCapture[flag];
    }
    if (snapshot.source.capture?.reportedTotal !== undefined) {
      if (reportedTotal !== undefined && reportedTotal !== snapshot.source.capture.reportedTotal)
        addIssue({
          code: 'collection-count-changed',
          message:
            'The page-reported total changed while loading. Counts are observed hints, not proof of completeness.',
        });
      reportedTotal = Math.max(reportedTotal ?? 0, snapshot.source.capture.reportedTotal);
    }
    for (const item of snapshot.verification.issues)
      if (!['missing-indices', 'reported-missing-turns', 'rendered-snapshot'].includes(item.code))
        addIssue(item);
  };
  const gaps = () => {
    const indices = ordered
      .map((id) => records.get(id).renderedIndex)
      .filter((index) => index !== undefined);
    const missing = [];
    if (indices.length && indices[0] > 0) missing.push({ from: 0, to: indices[0] - 1 });
    for (let index = 1; index < indices.length; index += 1)
      if (indices[index] > indices[index - 1] + 1)
        missing.push({ from: indices[index - 1] + 1, to: indices[index] - 1 });
    if (reportedTotal !== undefined && indices.length && indices.at(-1) < reportedTotal - 1)
      missing.push({ from: indices.at(-1) + 1, to: reportedTotal - 1 });
    return missing;
  };
  const build = () => {
    if (!base || !ordered.length) return undefined;
    const turns = ordered.map((id) => records.get(id));
    const collectedGaps = gaps();
    const collectionIssues = [
      ...issues.values(),
      {
        code: 'bounded-dom-collection',
        message:
          'This collection follows overlapping rendered windows of the displayed branch only. Observed scroll boundaries do not prove that the service supplied every turn or any hidden variant.',
      },
    ];
    if (collectedGaps.length)
      collectionIssues.push({
        code: 'collection-gaps',
        message:
          'Rendered indices or a page-reported total show missing turns. Use the conversation export to recover them.',
      });
    if (
      reportedTotal !== undefined &&
      (turns.length > reportedTotal || turns.some((turn) => turn.renderedIndex >= reportedTotal))
    )
      collectionIssues.push({
        code: 'collection-count-conflict',
        message:
          'The observed turns or indices exceed the page-reported total. The page count is inconsistent and cannot establish completeness.',
      });
    if (reason !== 'observed-boundaries')
      collectionIssues.push({
        code: `collection-${reason}`,
        message: `Collection stopped: ${reason}. Only the consistently observed turns are retained.`,
      });
    const capture = lastCapture
      ? {
          ...lastCapture,
          ...captureEvidence,
          observedTurns: turns.length,
          observedIndices: turns
            .filter((turn) => turn.renderedIndex !== undefined)
            .map((turn) => turn.renderedIndex),
          ...(reportedTotal !== undefined ? { reportedTotal } : {}),
        }
      : undefined;
    return validateConversation({
      schemaVersion: 1,
      source: {
        ...base.source,
        ...(capture ? { capture } : {}),
        collection: {
          startedAt: new Date(started).toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: Math.min(120000, Date.now() - started),
          steps,
          snapshots,
          orderedTurns: turns.length,
          startObserved,
          endObserved,
          restoredScroll,
          indicesAvailable: turns.every((turn) => turn.renderedIndex !== undefined),
          gaps: collectedGaps,
          stoppedReason: reason,
          ...(reportedTotal !== undefined ? { reportedTotal } : {}),
        },
      },
      turns,
      branches: {
        selectedLeaf: turns.at(-1).id,
        availableLeaves: [{ id: turns.at(-1).id, turnCount: turns.length }],
        selection: 'current-node',
      },
      verification: { status: 'unverified', issues: collectionIssues },
      attachments: [...files.values()],
    });
  };
  try {
    progress();
    origin = await inspect(true);
    let boundaryKey = '',
      boundarySince = 0,
      boundarySamples = 0,
      unchangedSince = Date.now(),
      previousState = '',
      transientErrors = 0;
    phase = 'up';
    while (true) {
      check();
      if (steps >= limits.steps) stop('step-limit', 'Collection reached its step limit.');
      steps += 1;
      const viewport = await inspect();
      let snapshot;
      try {
        snapshot = validateConversation(await call(() => driver.snapshot()));
      } catch (error) {
        if (
          !(error instanceof CollectionError) &&
          /rendered conversation changed|No visible user or assistant/iu.test(
            error.message ?? '',
          ) &&
          transientErrors < 5
        ) {
          transientErrors += 1;
          await pause();
          continue;
        }
        throw error;
      }
      snapshots += 1;
      transientErrors = 0;
      merge(snapshot);
      progress();
      if (snapshot.source.capture?.truncated)
        stop('capture-limit', 'A rendered window was truncated by its capture bound.');
      const state = JSON.stringify([
        viewport.scrollTop,
        viewport.scrollHeight,
        snapshot.turns.map((turn) => turn.id),
        ordered.length,
        Boolean(viewport.pending),
      ]);
      if (state !== previousState) {
        unchangedSince = Date.now();
        previousState = state;
      }
      const boundary = phase === 'up' ? viewport.atStart : viewport.atEnd;
      if (boundary && !viewport.pending) {
        if (state !== boundaryKey) {
          boundaryKey = state;
          boundarySince = Date.now();
          boundarySamples = 1;
        } else boundarySamples += 1;
        if (boundarySamples >= limits.samples && Date.now() - boundarySince >= limits.boundary) {
          if (phase === 'up') {
            startObserved = true;
            phase = 'down';
            boundaryKey = '';
            boundarySamples = 0;
            unchangedSince = Date.now();
            progress();
          } else {
            endObserved = true;
            reason = gaps().length ? 'gaps' : 'observed-boundaries';
            break;
          }
        }
      } else {
        boundaryKey = '';
        boundarySamples = 0;
      }
      if (Date.now() - unchangedSince >= limits.stall)
        stop(
          'stalled',
          'The conversation stopped loading or scrolling before a stable boundary was observed.',
        );
      const currentBoundary = phase === 'up' ? viewport.atStart : viewport.atEnd;
      if (!currentBoundary && !viewport.pending)
        await call(() =>
          driver.scroll({ direction: phase, fraction: 0.5, identity: origin.identity }),
        );
      await pause();
    }
  } catch (error) {
    reason =
      error instanceof CollectionError
        ? error.code
        : /page changed|conversation.*changed|document|navigation/iu.test(error.message ?? '')
          ? 'navigation'
          : /took control/iu.test(error.message ?? '')
            ? 'user-intervened'
            : 'capture-error';
    if (
      ![
        'step-limit',
        'duration-limit',
        'turn-limit',
        'byte-limit',
        'stalled',
        'capture-limit',
      ].includes(reason) ||
      !base
    )
      fatal =
        error instanceof CollectionError
          ? error
          : new CollectionError(reason, error.message ?? 'Collection failed.');
  } finally {
    phase = 'restoring';
    try {
      progress();
    } catch {
      /* UI observers cannot prevent page cleanup. */
    }
    let timer;
    try {
      // The initial viewport call can create its lease before cancellation wins the race.
      // Without a returned origin, release listeners only; never invent a scroll position.
      const command = origin
        ? { restore: true, scrollTop: origin.scrollTop, identity: origin.identity }
        : { release: true };
      const restored = await Promise.race([
        Promise.resolve().then(() => driver.restore(command)),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), 2000);
        }),
      ]);
      restoredScroll = restored?.restored === true;
    } catch {
      restoredScroll = false;
    } finally {
      clearTimeout(timer);
    }
  }
  result = build();
  if (result && encoder.encode(JSON.stringify(result)).byteLength > limits.bytes) {
    if (fatal) throw fatal;
    throw new CollectionError(
      'byte-limit',
      'Collection metadata exceeds its payload limit. Use the selected conversation export.',
    );
  }
  if (fatal) {
    if (result) fatal.partial = result;
    throw fatal;
  }
  phase = 'done';
  progress();
  return result;
}
