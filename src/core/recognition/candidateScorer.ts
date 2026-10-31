import type { Product } from '../types';
import { normalise, type TextLine } from './aisleMatcher';

/** Text lines grouped into one package-shaped cluster by the capture layer. */
export interface TextCluster {
  lines: TextLine[];
  box: { x: number; y: number; w: number; h: number };
}

export type FindOutcome =
  | { kind: 'candidate'; cluster: TextCluster; score: number; margin: number }
  | { kind: 'abstain'; reason: 'no_clusters' | 'below_threshold' | 'margin_too_small' };

export const T_ACCEPT = 2.0;
export const T_MARGIN = 0.75;

/**
 * Shelf-finding (P1, experiment). Text-first on purpose: a visual-similarity
 * stage is added only if evaluation shows text alone abstaining too often.
 *
 * `abstain` is a first-class outcome and must be logged as one. The AR
 * comparison depends on reporting abstentions separately from wrong confident
 * highlights — a system that says "I'm not sure" is behaving correctly, and
 * conflating the two hides the only failure mode that harms the shopper.
 */
export function scoreCandidates(clusters: TextCluster[], target: Product): FindOutcome {
  if (clusters.length === 0) return { kind: 'abstain', reason: 'no_clusters' };

  const required = requiredTokens(target);
  const supporting = supportingTokens(target);

  const scored = clusters.map((cluster) => {
    const text = cluster.lines.map((l) => normalise(l.text)).join(' ');
    const tokens = new Set(text.split(' ').filter(Boolean));

    // A size or distinguishing variant that is absent disqualifies outright —
    // this is the whole point of the feature: two near-identical packages.
    for (const req of required) {
      if (!req.some((alt) => tokens.has(alt))) return { cluster, score: 0 };
    }
    let score = required.length > 0 ? 1.5 : 0;
    for (const tok of supporting) if (tokens.has(tok)) score += 0.5;
    return { cluster, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  const second = scored[1]?.score ?? 0;

  if (best.score < T_ACCEPT) return { kind: 'abstain', reason: 'below_threshold' };
  if (best.score - second < T_MARGIN) return { kind: 'abstain', reason: 'margin_too_small' };
  return { kind: 'candidate', cluster: best.cluster, score: best.score, margin: best.score - second };
}

/** Each inner array is a set of acceptable spellings for one required fact. */
function requiredTokens(p: Product): string[][] {
  const out: string[][] = [];
  if (p.sizeText) {
    const n = normalise(p.sizeText);
    // Only the numeric part counts. Accepting the bare unit would let a 24 oz
    // box satisfy an 18 oz request, which is exactly the confusion this
    // feature exists to prevent.
    const numeric = n.split(' ').filter((t) => /\d/.test(t));
    out.push([n, ...numeric]);
  }
  if (p.variant) out.push(normalise(p.variant).split(' ').filter(Boolean));
  return out;
}

function supportingTokens(p: Product): string[] {
  const words = [p.brand, p.name, p.category].filter(Boolean).join(' ');
  return [...new Set(normalise(words).split(' ').filter((w) => w.length > 2))];
}
