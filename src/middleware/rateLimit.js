import { HttpError } from '../lib/http.js';

const WINDOW_MS = 15 * 60 * 1000;

// Limits requests per key (RATE_LIMIT_MAX per 15 minutes). Each call keeps its
// own counters, so every route gets its own budget. A falsy key is not counted.
const rateLimit = (keyOf) => {
  const hits = new Map();
  return (req, res, next) => {
    const key = keyOf(req);
    if (!key) return next();
    const now = Date.now();
    let hit = hits.get(key);
    if (!hit || hit.resetAt <= now) {
      hit = { count: 0, resetAt: now + WINDOW_MS };
      hits.set(key, hit);
    }
    hit.count += 1;
    if (hit.count > (Number(process.env.RATE_LIMIT_MAX) || 10)) {
      res.set('Retry-After', String(Math.ceil((hit.resetAt - now) / 1000)));
      return next(new HttpError(429, 'Too many requests. Try again later.'));
    }
    next();
  };
};

export { rateLimit };
