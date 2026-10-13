/** Shared exclusion rule for original-message import and stream completion. */
export function isInternalMessage(message) {
  return (
    message.metadata?.is_visually_hidden_from_conversation === true ||
    message.weight === 0 ||
    message.channel === 'analysis' ||
    (typeof message.recipient === 'string' &&
      message.recipient !== '' &&
      message.recipient !== 'all')
  );
}
