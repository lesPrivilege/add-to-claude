// All responses below are synthetic; no original fetch implementation is ever called.
const fixturePackets = [];
let fixtureWaiter;
window.acceptNativePacket = (packet) => {
  fixturePackets.push(packet);
  if (fixtureWaiter && packet.kind === 'response') {
    const resolve = fixtureWaiter;
    fixtureWaiter = null;
    resolve(packet);
  }
};
const observed = () =>
  new Promise((resolve) => {
    fixtureWaiter = resolve;
  });
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
const msg = (id, role, text) => ({
  id,
  author: { role },
  status: 'finished_successfully',
  end_turn: true,
  content: { content_type: 'text', parts: [text] },
});
let fixtureResponse,
  fixtureCalls = 0;
window.fetch = async function (input) {
  fixtureCalls++;
  const url = typeof input === 'string' ? new URL(input, location.href).href : input.url;
  const body = fixtureResponse;
  const identify = (response) => {
    Object.defineProperty(response, 'url', { value: url });
    const clone = response.clone.bind(response);
    response.clone = () => identify(clone());
    return response;
  };
  return identify(
    new Response(body, {
      headers: {
        'content-type': body.startsWith('data:') ? 'text/event-stream' : 'application/json',
      },
    }),
  );
};
window.runNativeFixtures = async () => {
  try {
    check(location.href === 'https://chatgpt.com/c/native-synthetic', 'Synthetic page identity');
    const conversation = {
      conversation_id: 'native-synthetic',
      current_node: 'a0',
      mapping: {
        root: { id: 'root', parent: null, message: null },
        u0: { id: 'u0', parent: 'root', message: msg('u0', 'user', 'Earlier question.') },
        a0: { id: 'a0', parent: 'u0', message: msg('a0', 'assistant', 'Earlier answer.') },
      },
    };
    fixtureResponse = JSON.stringify(conversation);
    let packetPromise = observed();
    check(
      (await (await fetch('/backend-api/conversation/native-synthetic')).text()) ===
        fixtureResponse,
      'Original GET body',
    );
    check((await packetPromise).body === fixtureResponse, 'Native GET message delivery');
    const stream = async (parent, userID, answerID, complete) => {
      fixtureResponse = `data: ${JSON.stringify({ conversation_id: 'native-synthetic', message: msg(answerID, 'assistant', '**原文** ✓\n') })}\n\n${complete ? 'data: [DONE]\n\n' : ''}`;
      packetPromise = observed();
      const body = await (
        await fetch(
          new Request('https://chatgpt.com/backend-api/f/conversation', {
            method: 'POST',
            body: JSON.stringify({
              action: 'next',
              conversation_id: 'native-synthetic',
              parent_message_id: parent,
              messages: [msg(userID, 'user', 'Synthetic question.')],
            }),
          }),
        )
      ).text();
      check(body === fixtureResponse, 'Original stream body');
      const packet = await packetPromise;
      check(packet.method === 'POST', 'Real POST provenance');
      return JSON.parse(packet.body);
    };
    let result = await stream('a0', 'u1', 'a1', true);
    check(
      result.streamCompleted &&
        result.conversation.mapping.a1.message.content.parts[0] === '**原文** ✓\n',
      'WebKit SSE and exact Unicode',
    );
    result = await stream('a1', 'u2', 'a2', false);
    check(!result.streamCompleted, 'Incomplete transport');
    result = await stream('a2', 'u3', 'a3', true);
    check(!result.streamCompleted, 'Historical uncertainty');
    check(
      document.querySelector('#draft').value === 'Unsent synthetic draft.',
      'Draft preservation',
    );
    check(fixtureCalls === 4, 'No observer requests');
    history.pushState({}, '', '/c/another-synthetic');
    await new Promise((resolve) => setTimeout(resolve, 30));
    check(fixturePackets.at(-1).kind === 'changed', 'Native navigation invalidation');
    window.webkit.messageHandlers.fixtureResult.postMessage({
      ok: true,
      message:
        'PASS native WebKit: GET, SSE/Request clone, exact Markdown/Unicode, incomplete transport/history, draft/no-extra-requests, navigation (7 scenarios)',
    });
  } catch (error) {
    window.webkit.messageHandlers.fixtureResult.postMessage({
      ok: false,
      message: String(error.stack || error),
    });
  }
};
