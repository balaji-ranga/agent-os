export const CHAT_CAPABILITY_LIMIT = 5;

// Each addition gets a fresh object identity, so a completed request cannot
// clear a capability that the user removed and reselected while it was running.
export function toggleChatCapability(current, item, key) {
  if (current.some(value => value[key] === item[key])) return current.filter(value => value[key] !== item[key]);
  if (current.length >= CHAT_CAPABILITY_LIMIT) return current;
  return [...current, { ...item }];
}

export function clearSubmittedCapabilities(current, submitted) {
  return current.filter(item => !submitted.includes(item));
}

export function chatCapabilityRefs(skills, tools) {
  return { skillRefs: skills.map(skill => skill.skill_id), toolRefs: tools.map(tool => tool.name) };
}
