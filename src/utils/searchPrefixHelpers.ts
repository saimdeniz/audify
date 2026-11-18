export function extractSearchPrefixValues(
  searchQuery: string,
  prefix: "bpm:" | "key:"
): string[] {
  if (!searchQuery.trim()) return [];
  const parts = searchQuery.trim().split(/\s+/);
  const out: string[] = [];
  for (const p of parts) {
    if (p.toLowerCase().startsWith(prefix) && p.length > prefix.length) {
      out.push(p.slice(prefix.length));
    }
  }
  return out;
}

export function removeSearchPrefixTokens(
  searchQuery: string,
  prefix: "bpm:" | "key:",
  specificVal?: string
): string {
  const parts = searchQuery.trim().split(/\s+/).filter(Boolean);
  return parts
    .filter((p) => {
      const lower = p.toLowerCase();
      if (!lower.startsWith(prefix)) return true;
      if (specificVal === undefined) return false;
      return lower !== `${prefix}${specificVal.toLowerCase()}`;
    })
    .join(" ");
}

export function upsertSearchPrefixToken(
  searchQuery: string,
  prefix: "bpm:" | "key:",
  nextVal: string | null
): string {
  const parts = searchQuery
    .trim()
    .split(/\s+/)
    .filter((p) => Boolean(p) && !p.toLowerCase().startsWith(prefix));
  if (nextVal && nextVal.trim()) {
    parts.push(`${prefix}${nextVal.trim()}`);
  }
  return parts.join(" ");
}
