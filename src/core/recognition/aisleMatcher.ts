import type { Aisle, AisleId } from '../types';

export interface TextLine {
  text: string;
  confidence: number;
}

export type AisleMatch =
  | { kind: 'match'; aisleId: AisleId; label: string }
  | { kind: 'ambiguous'; aisleIds: AisleId[] }
  | { kind: 'no_read' };

export interface MatcherOptions {
  /** Reject OCR lines below this confidence before matching. */
  cMin: number;
  /** Sliding window length in frames. */
  windowN: number;
  /** Frame-votes needed to accept. */
  voteK: number;
  /** A competitor with this many votes makes the read ambiguous instead. */
  competitorMax: number;
}

export const DEFAULT_MATCHER_OPTIONS: MatcherOptions = {
  cMin: 0.5,
  windowN: 5,
  voteK: 3,
  competitorMax: 2,
};

/** The attempt window the evaluation fixes before testing (plan §7.1). */
export const CHECKIN_ATTEMPT_MS = 4000;

const WEIGHT_NUMBER_EXACT = 3;
const WEIGHT_CATEGORY_EXACT = 1;
const WEIGHT_NUMBER_FUZZY = 1;

export function normalise(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i, ...new Array<number>(n).fill(0)];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return prev[n]!;
}

/**
 * Matches recognised sign text against **this store's declared sign variants
 * only**. A closed vocabulary turns open-ended OCR into a small classification
 * problem, which is what makes wrong-label errors rare; temporal agreement
 * across frames removes most single-frame misreads.
 *
 * Takes already-extracted text, never a camera frame — that separation is what
 * lets the same code be replayed against a saved corpus in evaluation.
 */
export class AisleMatcher {
  private readonly votes: (AisleId | null)[] = [];

  constructor(
    private readonly aisles: Aisle[],
    private readonly opts: MatcherOptions = DEFAULT_MATCHER_OPTIONS,
  ) {}

  reset(): void {
    this.votes.length = 0;
  }

  /** Score one frame's text, push a vote, then decide over the window. */
  observe(lines: TextLine[]): AisleMatch {
    this.votes.push(this.voteForFrame(lines));
    while (this.votes.length > this.opts.windowN) this.votes.shift();
    return this.decide();
  }

  scoreFrame(lines: TextLine[]): Map<AisleId, number> {
    const scores = new Map<AisleId, number>();
    const usable = lines.filter((l) => l.confidence >= this.opts.cMin).map((l) => normalise(l.text));

    for (const aisle of this.aisles) {
      let score = 0;
      for (const sv of aisle.signVariants) {
        const variant = normalise(sv.variant);
        for (const line of usable) {
          const tokens = line.split(' ');
          const exact = line === variant || tokens.includes(variant);
          if (exact) {
            score += sv.kind === 'number' ? WEIGHT_NUMBER_EXACT : WEIGHT_CATEGORY_EXACT;
            continue;
          }
          // "7" misread as "1" is real; allow one edit on numeric variants only.
          if (sv.kind === 'number') {
            const near = tokens.some((t) => t.length === variant.length && levenshtein(t, variant) <= 1);
            if (near) score += WEIGHT_NUMBER_FUZZY;
          }
        }
      }
      if (score > 0) scores.set(aisle.id, score);
    }
    return scores;
  }

  private voteForFrame(lines: TextLine[]): AisleId | null {
    const scores = this.scoreFrame(lines);
    if (scores.size === 0) return null;
    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    // A tie inside one frame is not a vote; let the window decide.
    if (ranked.length > 1 && ranked[0]![1] === ranked[1]![1]) return null;
    return ranked[0]![0];
  }

  private decide(): AisleMatch {
    const tally = new Map<AisleId, number>();
    for (const v of this.votes) {
      if (v === null) continue;
      tally.set(v, (tally.get(v) ?? 0) + 1);
    }
    if (tally.size === 0) return { kind: 'no_read' };

    const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    const [topId, topVotes] = ranked[0]!;
    const secondVotes = ranked[1]?.[1] ?? 0;

    if (topVotes >= this.opts.voteK) {
      if (secondVotes >= this.opts.competitorMax) {
        return { kind: 'ambiguous', aisleIds: ranked.filter((r) => r[1] >= this.opts.competitorMax).map((r) => r[0]) };
      }
      const aisle = this.aisles.find((a) => a.id === topId);
      return { kind: 'match', aisleId: topId, label: aisle?.label ?? String(topId) };
    }
    return { kind: 'no_read' };
  }
}

/**
 * Reading "7" identifies the aisle. It does not identify where along the aisle
 * the shopper is, or which way they face — so a check-in records only the
 * aisle, and end disambiguation is asked for separately, and only when it
 * changes the instruction.
 */
export function endsNeedingDisambiguation(
  aisle: Aisle,
  instructionFor: (end: number) => string,
): number[] {
  const distinct = new Set(aisle.ends.map(instructionFor));
  return distinct.size > 1 ? aisle.ends : [];
}
