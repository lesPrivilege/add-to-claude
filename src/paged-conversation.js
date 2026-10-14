/**
 * The live site (2026-10) loads a conversation as one page of its selected branch:
 * `{ conversation_id, title, messages: [...], current_node, page_info }` from
 * `/backend-api/conversations/<id>`. This turns that page into the classic `mapping` tree the
 * importer and the stream merger already understand. Older-page coverage travels in `page_info`.
 * Self-contained: it is also serialized into the page observer.
 */
export function toMappingConversation(value) {
  if (!value || typeof value !== 'object' || value.mapping || !Array.isArray(value.messages))
    return value;
  const id = value.conversation_id ?? value.id;
  const root = `page-root-${id}`;
  const mapping = { [root]: { id: root, parent: null, children: [], message: null } };
  let parent = root;
  for (const message of value.messages) {
    if (!message || typeof message.id !== 'string' || mapping[message.id]) continue;
    mapping[message.id] = { id: message.id, parent, children: [], message };
    mapping[parent].children.push(message.id);
    parent = message.id;
  }
  const { messages, ...rest } = value;
  return {
    ...rest,
    conversation_id: id,
    mapping,
    current_node: mapping[value.current_node] ? value.current_node : parent,
  };
}
