import { importBrowserResponse } from '/src/chatgpt-response.js';
import { projectMarkdown } from '/src/model.js';

// This local view has no website content and no native target-operation handler.
globalThis.handoffCore = Object.freeze({
  compile(body, evidence) {
    const model = importBrowserResponse(body, evidence);
    return { model, markdown: projectMarkdown(model) };
  },
});

// WebKit navigation completion can precede module evaluation. Signal actual compiler readiness.
globalThis.webkit?.messageHandlers?.handoffCoreReady?.postMessage('ready');
