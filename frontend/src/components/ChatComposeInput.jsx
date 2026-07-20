import { handleChatComposeKeyDown } from '../utils/chatCompose.js';

/**
 * Multiline chat input: Enter to send, Shift+Enter for a new line.
 */
export default function ChatComposeInput({
  value,
  onChange,
  onSend,
  placeholder = 'Message…',
  rows = 3,
  disabled = false,
  className,
  style,
  ...rest
}) {
  return (
    <textarea
      value={value}
      onChange={onChange}
      onKeyDown={(e) => handleChatComposeKeyDown(e, onSend)}
      placeholder={placeholder}
      rows={rows}
      disabled={disabled}
      className={className}
      style={style}
      {...rest}
    />
  );
}
