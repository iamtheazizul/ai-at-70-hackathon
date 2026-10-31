// Shopping-list product → store section matching (from storeRoute.js).
// Order: exact (ignoring case/plurals) > partial ("cherry tomato" ~ "tomato") > fuzzy typo (1-2 edits).

// Lightweight singularizer so "tomatoes" = "tomato", "batteries" = "battery", "eggs" = "egg".
export const singular = (w) =>
  w.length < 4 ? w : w.replace(/ies$/, "y").replace(/(o|ch|sh|ss|x)es$/, "$1").replace(/(?<![su])s$/, "");

export const normItem = (s) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean).map(singular).join(" ");

export function lev(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** Index every aisle's categories (and its display name) for matching. */
export function buildItemIndex(aisles) {
  const entries = [];
  for (const a of aisles)
    for (const item of [...(a.items || []), a.name]) {
      const key = item && normItem(item);
      if (key) entries.push({ section: a.id, item, key, words: key.split(" ") });
    }
  return entries;
}

/** Returns { type, candidates:[{section,item}], suggestions:[] }. */
export function matchProduct(entries, name) {
  const q = normItem(name);
  if (!q) return { type: null, candidates: [], suggestions: [] };
  const qw = q.split(" ");

  let c = entries.filter((e) => e.key === q);
  if (c.length) return { type: "exact", candidates: c, suggestions: [] };

  c = entries.filter((e) => e.words.every((w) => qw.includes(w)) || qw.every((w) => e.words.includes(w)));
  if (c.length) {
    const best = Math.min(...c.map((e) => Math.abs(e.words.length - qw.length)));
    return { type: "partial", candidates: c.filter((e) => Math.abs(e.words.length - qw.length) === best), suggestions: [] };
  }

  const scored = entries.map((e) => ({ e, d: lev(e.key, q) })).sort((a, b) => a.d - b.d);
  const limit = q.length >= 8 ? 2 : q.length >= 4 ? 1 : 0;
  const close = scored.filter((x) => x.d <= limit);
  if (close.length) {
    const m = close[0].d;
    return { type: "fuzzy", candidates: close.filter((x) => x.d === m).map((x) => x.e), suggestions: [] };
  }
  const suggestions = [...new Set(scored.filter((x) => x.d <= Math.max(3, Math.ceil(q.length / 2))).slice(0, 3).map((x) => x.e.item))];
  return { type: null, candidates: [], suggestions };
}

/** "milk, eggs\nbread" → ["milk", "eggs", "bread"] */
export const parseShoppingList = (text) => text.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
