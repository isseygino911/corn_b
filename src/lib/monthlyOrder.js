// Seeded shuffle for the sold gallery: the same order all month for every visitor, a new one each month.

// Small seeded PRNG (mulberry32).
const random = (seed) => {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// FNV-1a hash of the month key, e.g. "2026-11".
const hash = (text) => [...text].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);

// Fisher-Yates shuffle of a copy of items, seeded by the month ("YYYY-MM").
const monthlyOrder = (items, month) => {
  const next = random(hash(month));
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

export { monthlyOrder };
