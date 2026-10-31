// Inline SVG icons and the explainer drawings used in popups.

export const ICON_H = '<svg viewBox="0 0 34 22"><rect x="2" y="7" width="30" height="8" rx="2" fill="currentColor"/></svg>';
export const ICON_V = '<svg viewBox="0 0 34 22"><rect x="13" y="1" width="8" height="20" rx="2" fill="currentColor"/></svg>';
export const ICON_CAM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';

/** Top-down store: you at the entrance facing in, one vertical and one horizontal aisle. */
export function orientIllus() {
  return `<svg viewBox="0 0 380 270" role="img" aria-label="Top-down store: you stand at the entrance facing in. A vertical aisle runs away from you; a horizontal aisle runs left to right.">
  <rect x="20" y="16" width="340" height="206" rx="4" fill="none" stroke="var(--ink)" stroke-width="2"/>
  <text x="190" y="34" text-anchor="middle" font-family="var(--mono)" font-size="10" fill="var(--muted)">BACK OF STORE</text>
  <rect x="160" y="219" width="60" height="6" fill="var(--floor)"/>
  <path d="M190 236 L120 70 L260 70 Z" fill="var(--accent)" opacity=".1"/>
  <rect x="96" y="58" width="18" height="130" rx="3" fill="var(--accent)"/>
  <path d="M105 176 V74 M99 82 L105 72 L111 82" stroke="var(--accent-ink)" stroke-width="2" fill="none"/>
  <text x="122" y="128" font-family="var(--body)" font-weight="700" font-size="13" fill="var(--ink)">Vertical</text>
  <text x="122" y="143" font-family="var(--body)" font-size="11" fill="var(--muted)">runs away from you</text>
  <rect x="200" y="96" width="138" height="18" rx="3" fill="var(--tag)"/>
  <path d="M210 105 H326 M318 99 L328 105 L318 111" stroke="var(--tag-ink)" stroke-width="2" fill="none"/>
  <text x="200" y="132" font-family="var(--body)" font-weight="700" font-size="13" fill="var(--ink)">Horizontal</text>
  <text x="200" y="147" font-family="var(--body)" font-size="11" fill="var(--muted)">runs across, left to right</text>
  <circle cx="190" cy="242" r="9" fill="var(--ink)"/><path d="M190 232 L184 222 M190 232 L196 222" stroke="var(--ink)" stroke-width="2"/>
  <text x="206" y="246" font-family="var(--body)" font-weight="700" font-size="12" fill="var(--ink)">You, at the entrance, facing in</text>
  <text x="190" y="264" text-anchor="middle" font-family="var(--mono)" font-size="10" fill="var(--muted)">ENTRANCE</text></svg>`;
}

// Walking-direction buttons, as seen from above with the entrance at the bottom.
const arrow = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
export const ICON_FLOW = {
  cf: arrow("M12 20V5M6 11l6-6 6 6"),
  fc: arrow("M12 4v15M6 13l6 6 6-6"),
  lr: arrow("M4 12h15M13 6l6 6-6 6"),
  rl: arrow("M20 12H5M11 6l-6 6 6 6"),
};

/** An aisle from above: both shelves labelled L / R for someone walking in direction f. */
export function sidesIllus(f) {
  const vert = f === "cf" || f === "fc";
  const WALL = { cf: { left: "west", right: "east" }, fc: { left: "east", right: "west" }, lr: { left: "north", right: "south" }, rl: { left: "south", right: "north" } }[f];
  const strip = { west: [30, 12, 14, 76], east: [76, 12, 14, 76], north: [10, 28, 100, 14], south: [10, 66, 100, 14] };
  const shelves = vert ? ["west", "east"] : ["north", "south"];
  const label = (wall) => (WALL.left === wall ? "L" : "R");
  const arrows = { cf: "M60 80 V24 M53 32 L60 22 L67 32", fc: "M60 20 V76 M53 68 L60 78 L67 68", lr: "M22 54 H96 M88 47 L98 54 L88 61", rl: "M98 54 H24 M32 47 L22 54 L32 61" };
  return `<svg viewBox="0 0 120 120" aria-hidden="true">
    ${shelves.map((w) => { const [x, y, ww, hh] = strip[w]; return `<rect x="${x}" y="${y}" width="${ww}" height="${hh}" rx="2" fill="var(--accent)"/><text x="${x + ww / 2}" y="${y + hh / 2}" text-anchor="middle" dominant-baseline="central" font-family="var(--mono)" font-weight="700" font-size="11" fill="var(--accent-ink)">${label(w)}</text>`; }).join("")}
    <path d="${arrows[f]}" stroke="var(--ink)" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="10" y1="104" x2="110" y2="104" stroke="var(--muted)" stroke-dasharray="3 3"/>
    <text x="60" y="117" text-anchor="middle" font-family="var(--mono)" font-size="9" fill="var(--muted)">ENTRANCE</text></svg>`;
}

/** One flow option: an aisle with an arrow, seen from the entrance. */
export function flowIllus(f) {
  const vert = f === "cf" || f === "fc";
  const box = vert
    ? '<rect x="52" y="14" width="16" height="70" rx="3" fill="var(--line)"/>'
    : '<rect x="18" y="44" width="84" height="16" rx="3" fill="var(--line)"/>';
  const arrows = { cf: "M60 78 V22 M53 30 L60 20 L67 30", fc: "M60 20 V76 M53 68 L60 78 L67 68", lr: "M24 52 H94 M86 45 L96 52 L86 59", rl: "M96 52 H26 M34 45 L24 52 L34 59" };
  return `<svg viewBox="0 0 120 120" aria-hidden="true">${box}<path d="${arrows[f]}" stroke="var(--accent)" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <line x1="10" y1="104" x2="110" y2="104" stroke="var(--muted)" stroke-dasharray="3 3"/><circle cx="60" cy="104" r="6" fill="var(--ink)"/>
  <text x="60" y="118" text-anchor="middle" font-family="var(--mono)" font-size="9" fill="var(--muted)">YOU</text></svg>`;
}
