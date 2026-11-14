# Slice — Sold items (carousel + /sold page)

Backend `corn_b` + UI in `../corn`. Agreed with the owner in a grilling session (2026-11-14); do not widen scope.
Work on `main` in place. Never `git commit`/`push` unless asked. Production DB/bucket only on the owner's go-ahead.

## Backend
- Migration `005_sold.sql`: `products.sold BOOL NOT NULL DEFAULT 0`.
- Sold products are excluded from `GET /api/products`, `GET /api/products/:slug`, checkout quotes and orders (they read as not found).
- `GET /api/products/sold` (public) → `{products:[{publicId, name, description, collection, colorway, mainImageUrl}]}` for `sold = 1 AND active = 1 AND archived_at IS NULL`.
- Admin product create/update accepts `sold` (boolean); admin views include it. Admin form gets a "Sold" switch.

## Data import
- 191 photos in `~/Desktop/rednote-corn-200-photos/Full-size photos/` (1080×1440 webp). `Collage tiles` ignored.
- Details generated from the photos into `scripts/sold-items.json` `[{file, name, description, collection, colorway}]`; owner reviews before upload.
  Cob shapes → `charms`, round/fruit shapes → `pearls`; colorway = one lowercase word.
- `scripts/import-sold.js <photos dir>`: per entry, PutObject `products/<uuid>.webp`, create product (price 0, stock 0, active 1, sold 1,
  slug `sold-NNN` from the file number) with that image as main. Existing slugs are skipped, so re-runs are safe. Local first; production on go-ahead.

## Frontend
- shadcn Carousel (+ `embla-carousel-react`, approved). The landing loads the sold carousel as a lazy chunk with the UI kit CSS
  (amends the slice-3 isolation rule; Tailwind is `tw:`-prefixed, no preflight). Landing must stay visually identical elsewhere at 390 px and desktop.
- Home: sold carousel right after Collections, first 12 in the month's order. Image-only 3:4 cards, "Sold" pill top-right (rose),
  ~360 px tall desktop / ~300 px phone, "See all" → `/sold`.
- `/sold` (shop shell): heading "Sold in {Mon}" from the visitor's current month; order shuffled with a seed of the local `YYYY-MM`
  (same for everyone in a month, changes monthly). Cards: same image + pill, name, one-line description. Grid 1 / 2 / 3 columns (phone / tablet / desktop).

## Order of work
1. Migration, API, admin field, tests (`npm test` green).
2. Names → owner review → import script run locally.
3. Carousel + `/sold` (`npm run build` clean), browser check at 390 px and desktop, then `code-review`. No commit unless asked.
