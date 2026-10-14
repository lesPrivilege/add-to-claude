/** Shared exclusion rule for original-message import and stream completion.
 * Reasoning ("Thinking") and memory/context entries are not part of the visible exchange. */
export function isInternalMessage(message) {
  return (
    message.metadata?.is_visually_hidden_from_conversation === true ||
    ['thoughts', 'reasoning_recap', 'model_editable_context', 'user_editable_context'].includes(
      message.content?.content_type,
    ) ||
    message.weight === 0 ||
    message.channel === 'analysis' ||
    (typeof message.recipient === 'string' &&
      message.recipient !== '' &&
      message.recipient !== 'all')
  );
}
