import { describe, expect, it } from 'vitest';
import { AisleMatcher, DEFAULT_MATCHER_OPTIONS, endsNeedingDisambiguation, levenshtein, normalise } from '../src/core/recognition/aisleMatcher';
import { framingGuideWidthPx, previewTooNarrow, resolveBarcode } from '../src/core/recognition/barcodeResolver';
import { scoreCandidates, type TextCluster } from '../src/core/recognition/candidateScorer';
import { sampleList, sampleStorePack } from '../src/data/sampleStore';

const pack = sampleStorePack;
const line = (text: string, confidence = 0.9) => ({ text, confidence });
const frame = (...texts: string[]) => texts.map((t) => line(t));

describe('text helpers', () => {
  it('normalises punctuation and case', () => {
    expect(normalise(' aisle-7:  cereal ')).toBe('AISLE 7 CEREAL');
  });
  it('measures single-character edits', () => {
    expect(levenshtein('7', '1')).toBe(1);
    expect(levenshtein('CEREAL', 'CEREAL')).toBe(0);
  });
});

describe('aisle matcher', () => {
  it('accepts only after repeated agreement across frames', () => {
    const m = new AisleMatcher(pack.aisles);
    expect(m.observe(frame('AISLE 3')).kind).toBe('no_read'); // 1 vote
    expect(m.observe(frame('AISLE 3')).kind).toBe('no_read'); // 2 votes
    const third = m.observe(frame('AISLE 3'));               // 3 votes = voteK
    expect(third.kind).toBe('match');
    if (third.kind === 'match') expect(third.label).toBe('3');
  });

  it('reads a category-only sign', () => {
    const m = new AisleMatcher(pack.aisles);
    let result = m.observe(frame('CEREAL'));
    result = m.observe(frame('CEREAL'));
    result = m.observe(frame('CEREAL'));
    expect(result.kind).toBe('match');
    if (result.kind === 'match') expect(result.aisleId).toBe(3);
  });

  it('abstains when every line is below the confidence floor', () => {
    const m = new AisleMatcher(pack.aisles);
    for (let i = 0; i < 5; i++) {
      expect(m.observe([line('AISLE 3', 0.2)]).kind).toBe('no_read');
    }
  });

  it('abstains on an unknown label rather than guessing', () => {
    const m = new AisleMatcher(pack.aisles);
    for (let i = 0; i < 5; i++) {
      expect(m.observe(frame('PHARMACY')).kind).toBe('no_read');
    }
  });

  it('reports ambiguity when the window is split between two aisles', () => {
    const m = new AisleMatcher(pack.aisles);
    m.observe(frame('AISLE 3'));
    m.observe(frame('AISLE 3'));
    m.observe(frame('AISLE 4'));
    m.observe(frame('AISLE 4'));
    const result = m.observe(frame('AISLE 3'));
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') expect(result.aisleIds.sort()).toEqual([3, 4]);
  });

  it('forgets old frames outside the window', () => {
    const m = new AisleMatcher(pack.aisles, { ...DEFAULT_MATCHER_OPTIONS, windowN: 3 });
    m.observe(frame('AISLE 3'));
    m.observe(frame('PHARMACY'));
    m.observe(frame('PHARMACY'));
    expect(m.observe(frame('PHARMACY')).kind).toBe('no_read');
  });

  it('asks for the aisle end only when it changes the instruction', () => {
    const aisle = pack.aisles.find((a) => a.id === 3)!;
    const sameEither = endsNeedingDisambiguation(aisle, () => 'Walk down aisle 3');
    expect(sameEither).toEqual([]);
    const differs = endsNeedingDisambiguation(aisle, (end) => `from ${end}`);
    expect(differs).toEqual(aisle.ends);
  });
});

describe('barcode verification', () => {
  const branFlakes18 = sampleList.find((e) => e.id === 4)!; // requests product 5 only

  it('verifies a code in the accepted set', () => {
    const out = resolveBarcode('4011000000005', pack, branFlakes18);
    expect(out.kind).toBe('verified');
  });

  it('names the near-twin on a known mismatch instead of just refusing', () => {
    const out = resolveBarcode('4011000000006', pack, branFlakes18);
    expect(out.kind).toBe('known_mismatch');
    if (out.kind === 'known_mismatch') {
      expect(out.product.sizeText).toBe('24 oz');
      expect(out.requested).toContain('18 oz');
    }
  });

  it('reports an unknown code rather than inventing a product', () => {
    expect(resolveBarcode('9999999999999', pack, branFlakes18).kind).toBe('unknown_code');
  });

  it('tolerates surrounding whitespace from the decoder', () => {
    expect(resolveBarcode('  4011000000005 ', pack, branFlakes18).kind).toBe('verified');
  });

  it('sizes the framing guide to clear the decodable width', () => {
    expect(framingGuideWidthPx(1080)).toBeGreaterThanOrEqual(190);
    expect(previewTooNarrow(1080)).toBe(false);
    expect(previewTooNarrow(400)).toBe(true);
  });
});

describe('shelf-finding candidate scorer', () => {
  const target = pack.products.find((p) => p.id === 5)!; // Harvest bran flakes, 18 oz

  const cluster = (text: string): TextCluster => ({
    lines: [line(text)],
    box: { x: 0, y: 0, w: 100, h: 100 },
  });

  it('picks the right size out of two near-identical packages', () => {
    const out = scoreCandidates(
      [cluster('HARVEST BRAN FLAKES ORIGINAL 24 OZ'), cluster('HARVEST BRAN FLAKES ORIGINAL 18 OZ')],
      target,
    );
    expect(out.kind).toBe('candidate');
    if (out.kind === 'candidate') {
      expect(out.cluster.lines[0]!.text).toContain('18 OZ');
    }
  });

  it('abstains when two clusters are equally good', () => {
    const out = scoreCandidates(
      [cluster('HARVEST BRAN FLAKES ORIGINAL 18 OZ'), cluster('HARVEST BRAN FLAKES ORIGINAL 18 OZ')],
      target,
    );
    expect(out.kind).toBe('abstain');
    if (out.kind === 'abstain') expect(out.reason).toBe('margin_too_small');
  });

  it('abstains rather than highlighting a wrong-size package', () => {
    const out = scoreCandidates([cluster('HARVEST BRAN FLAKES ORIGINAL 24 OZ')], target);
    expect(out.kind).toBe('abstain');
    if (out.kind === 'abstain') expect(out.reason).toBe('below_threshold');
  });

  it('abstains when there is nothing to read', () => {
    const out = scoreCandidates([], target);
    expect(out.kind).toBe('abstain');
    if (out.kind === 'abstain') expect(out.reason).toBe('no_clusters');
  });
});
