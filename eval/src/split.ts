import type { ManifestPr } from './types.js';

// Small seeded PRNG (mulberry32) so the split is reproducible from the seed
// alone, on any platform.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Development / held-out split, stratified by source repository:
// `devPerSource` PRs of each source go to dev, the rest are held out.
export function makeSplit(
  manifest: ManifestPr[],
  seed: number,
  devPerSource: number,
): { seed: number; dev: string[]; heldout: string[] } {
  const random = mulberry32(seed);
  const dev: string[] = [];
  const heldout: string[] = [];
  const sources = [...new Set(manifest.map((p) => p.source))].sort();
  for (const source of sources) {
    const ids = manifest
      .filter((p) => p.source === source)
      .map((p) => p.id)
      .sort();
    // Fisher–Yates
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    dev.push(...ids.slice(0, devPerSource).sort());
    heldout.push(...ids.slice(devPerSource).sort());
  }
  return { seed, dev, heldout };
}
