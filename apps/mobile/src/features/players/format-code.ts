/** Display form of an eight-character join code, matching the website players dialog. */
export function formatJoinCode(code: string): string {
  const raw = code.replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (raw.length <= 4) return raw;
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}
