/**
 * Shared validation for agent icon / profile image (hire, publish, PATCH).
 * Empty string means "use the default robot icon in the UI".
 */
const MAX_CHARS = 900_000;

export function normalizeAgentAvatar(raw) {
  if (raw == null) return '';
  const img = String(raw).trim();
  if (!img) return '';
  if (img.length > MAX_CHARS) {
    throw new Error('Agent avatar is too large (max ~650KB)');
  }
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(img) && !/^https?:\/\//i.test(img)) {
    throw new Error('Agent avatar must be a data URL (png/jpeg/webp/gif) or https URL');
  }
  return img;
}
