export function normalizeSlackNickname(value: string): string {
  return value.trim().replace(/^@+/, "").trim().replace(/\s+/g, " ");
}

export function displaySlackNickname(value: string): string {
  const normalized = normalizeSlackNickname(value);
  return normalized ? `@${normalized}` : "";
}

export function truncateForNotion(value: string, maxLength = 1900): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
