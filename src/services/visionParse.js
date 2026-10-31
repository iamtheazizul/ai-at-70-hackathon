// Turns the vision model's text reply into clean data. Pure functions: runs in the
// browser, in Node, and in tests.

export const MAX_CATEGORIES = 12;

/** Lowercase, trim, drop junk and duplicates, cap the list. */
export function cleanCategories(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw !== "string") continue;
    const c = raw.toLowerCase().replace(/\s+/g, " ").replace(/^[\s\-•*]+|[\s.,;:!]+$/g, "").trim();
    if (!c || c.length > 40 || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
    if (out.length >= MAX_CATEGORIES) break;
  }
  return out;
}

/** Accept "7", 7 or "12B". Anything else (words, long strings) is treated as unreadable. */
export function cleanAisleNo(v) {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  return /^\d{1,3}[a-z]?$/i.test(s) ? s.toUpperCase() : null;
}

/** Parse the model reply: JSON, possibly wrapped in prose or a code fence. Throws if unusable. */
export function parseVisionReply(text) {
  const m = String(text ?? "").match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON in model reply");
  let data;
  try { data = JSON.parse(m[0]); } catch (e) { throw new Error("Model reply was not valid JSON"); }
  return {
    categories: cleanCategories(data.categories),
    aisleNo: cleanAisleNo(data.aisle_number ?? data.aisleNo),
  };
}
