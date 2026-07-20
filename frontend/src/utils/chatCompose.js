/**
 * Chat compose keyboard: Enter sends, Shift+Enter inserts a newline.
 */
export function handleChatComposeKeyDown(e, onSend) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    onSend(e);
  }
}
