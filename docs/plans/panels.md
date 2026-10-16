# Slice 2 — Admin panel, user panel, products, accessories, storefront product page

Backend `corn_b` + UI in `../corn`. Agreed with the owner in a grilling session; do not widen scope.
Out of scope: cart, checkout, orders, payments, order history data, shipping rules, stock decrement.

## Rules
- Plain JavaScript, ESM, Node 22. Same conventions as `auth.md` (DRY, no dead code, no speculative abstraction).
- New dependencies, approved: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `country-state-city` (all `corn_b`).
  Nothing else. Check current docs (Context7) before using each.
- Never `git commit`/`git push`. Never commit `.env`. No real secrets. The owner pastes real S3 values into `.env`.
- `corn_b` has no commits yet, so a worktree is not possible; work in place.
- `is_admin` stays settable only by `npm run make-admin`. No UI toggle.

## Decisions (owner-confirmed)
- Panels live in the same `corn` app: `/account/*` (users) and `/admin/*` (admins). Reuse `AuthContext` and tokens
  (bone / rose / ink / gold). Plain functional layout: sidebar left, content pane right. Admin routes lazy-loaded so GSAP/Lenis
  are not shipped to them. Backend enforces `requireAdmin`/`requireUser` regardless of UI guards.
- Currency USD only. Money is integer cents everywhere. The server computes totals; a client-sent total is never trusted.
- Archive, never hard delete, for products and accessories (`archived_at`); archived rows are hidden from lists and the storefront.
- Product visibility is one `active` flag (no separate "published").
- Stock 0 = "Sold out" (product stays visible). Stock is not decremented in this slice.
- Images on S3 via presigned PUT; the server never handles file bytes.

## Environment additions (`.env.example`, placeholders only)
`S3_BUCKET=`, `AWS_REGION=`, `AWS_ACCESS_KEY_ID=`, `AWS_SECRET_ACCESS_KEY=`. The bucket stays private: reads use signed GET links (`storage.signedReadUrl`, valid 1-2 h), no public URL setting.
Under `NODE_ENV=test` the S3 signer is stubbed; tests never touch AWS.
Bucket needs a CORS rule allowing `PUT` from `APP_URL` (document in `CLAUDE.md`).

## Data (migration `migrations/002_catalog.sql`)
- `products`: `id` PK, `public_id` CHAR(36) UNIQUE (UUID), `sku` VARCHAR UNIQUE, `name`, `slug` UNIQUE, `description` TEXT,
  `collection` ENUM('charms','pearls'), `colorway` VARCHAR (one of the six in `corn/src/colorways.js`), `price_cents` INT UNSIGNED,
  `stock` INT UNSIGNED default 0, `active` BOOL default 0, `archived_at` NULL, `created_at`, `updated_at`.
- `product_images`: `id`, `product_id` FK CASCADE, `s3_key`, `is_main` BOOL, `position` TINYINT. Max 5 per product, exactly one main.
- `accessories`: `id` PK, `public_id` CHAR(36) UNIQUE (UUID), `sku` UNIQUE, `name`, `description` NULL, `price_cents`,
  `stock`, `active`, `image_key` NULL, `archived_at` NULL, timestamps.
- `product_accessories`: `product_id` FK CASCADE, `accessory_id` FK CASCADE, PK (product_id, accessory_id).
- `addresses`: `id`, `user_id` FK CASCADE, `full_name`, `phone`, `line1`, `line2` NULL, `country_code`, `state_code`, `city`,
  `postal_code`, `is_default` BOOL. Max 10 per user. Exactly one default when the user has any (first becomes default;
  deleting the default promotes the oldest remaining). Joined to users when needed.
- SKU format: three letters + four digits. Prefix `CHM` (charms), `PRL` (pearls), `ACC` (accessories); digits = next number for that
  prefix, zero-padded. Auto-generated, editable, unique (409 on clash).

## Geo
`country-state-city` backs `GET /api/geo/countries`, `/api/geo/states?country=`, `/api/geo/cities?country=&state=` (public, cached headers).
Address create/update validates country and state against the same data. City is a dropdown when the state has cities,
otherwise free text. No hardcoded country/state lists anywhere.

## API (JSON; errors `{error, code?}`; user shape unchanged)
Public:
| Endpoint | Result |
|---|---|
| `GET /api/products` | active, non-archived products: `publicId, sku, name, slug, collection, colorway, priceCents, soldOut, mainImageUrl`; filter `?collection=` |
| `GET /api/products/:slug` | full product: images, description, allowed active accessories (`publicId, name, priceCents, soldOut, imageUrl`) |
| `POST /api/products/:slug/quote` | body `{accessoryIds: [uuid…]}` (any subset incl. none) → `{productCents, accessories:[…], totalCents}`; 400 on an accessory not allowed/active/sold out |
| `GET /api/geo/*` | as above |

User (`requireUser`, own data only):
| Endpoint | Result |
|---|---|
| `PATCH /api/account/profile` | `{name}` → user |
| `GET/POST /api/account/addresses`, `PATCH/DELETE /api/account/addresses/:id`, `POST …/:id/default` | address CRUD; scoped to `req.user` (404 for others' rows) |
| existing `POST /api/auth/change-password`, `/logout` | reused by the panel |

Admin (`requireAdmin`):
| Endpoint | Result |
|---|---|
| `GET /api/admin/dashboard` | counts: users, products (active/inactive), accessories, sold-out |
| `GET /api/admin/users?q=&page=` | read-only: name, email, verified, sign-in method (password/google/both), admin, createdAt; paginated |
| `GET/POST /api/admin/products`, `GET/PATCH /api/admin/products/:id` | list (incl. inactive; `?archived=`), create, read, update; body includes `accessoryIds` (replaces links) |
| `POST /api/admin/products/:id/archive` and `/restore` | soft delete |
| `POST /api/admin/uploads` | body `{contentType, size}` → `{uploadUrl, key, publicUrl}`; JPEG/PNG/WebP only, ≤5 MB, key `products/<uuid>.<ext>` |
| `PUT /api/admin/products/:id/images` | ordered `[{key, isMain}]`, 1–5 items, exactly one main |
| `GET/POST /api/admin/accessories`, `PATCH`, archive/restore | same pattern; one `imageKey` |

## Backend structure (mirror slice 1)
`src/routes/{products,geo,account,admin}.js` · `src/controllers/…` · `src/services/{catalog,pricing,addresses,geo,storage,adminUsers}.js` ·
`src/lib/sku.js` · `src/lib/validate.js` (extend, do not duplicate). `services/storage.js` is the only file that knows S3.
`services/pricing.js` is the single place totals are computed (used by `quote`, and later by orders).

## Frontend (`corn/`)
- Router: `/account` (profile, password, addresses, orders-empty-state) and `/admin` (dashboard, products, accessories, users),
  each with sidebar + content pane; non-admin on `/admin/*` → redirect to `/`; signed-out → `/login`.
- Admin product form: all fields, accessory multi-select, image uploader (1 main + 4 sub, reorder, direct-to-S3 PUT), SKU auto-filled and editable.
- Product detail page `/products/:slug`: gallery, description, accessory checkboxes, live total from `/quote` (or the same math client-side,
  with the server as source of truth), "Sold out" state. No cart or checkout button.
- Address form: country → state → city dropdowns from `/api/geo/*`.
- Respect `prefers-reduced-motion`; usable at 390 px. `npm run build` warning-free.

## Tests (`node:test`, helpers from slice 1; S3 stubbed)
Catalog CRUD and archive/restore; SKU generation + uniqueness; accessory link replace; price quote (subset, none, sold out, inactive,
not-allowed accessory, total math $10 + 2 + 2 + 6 = $20); image rules (max 5, one main, type/size limits); `requireAdmin` on every admin
route (401/403); address ownership isolation, default promotion, 10 cap; geo validation; profile update; users list search/pagination;
public endpoints never leak inactive/archived rows.

## Order of work (each step ends green)
1. Migration + catalog/accessory services + admin product/accessory API + tests (incl. storage stub).
2. Public products + quote + geo + tests.
3. Account profile + addresses + tests.
4. Admin users + dashboard + tests.
5. Frontend: panel shells and routing, then admin screens, user panel screens, product page.
6. `verify-app` in the browser, then `code-review`. No commit.

## Open items for the owner
- Paste S3 values into `.env`; create the bucket and its CORS rule.
- Confirm the six colorway names are the allowed `colorway` values.
- Production Google OAuth client and domain (carried over from slice 1).

## Pinned response shapes (added after tester review; binding for backend, tests and frontend)
- Create → 201. Single entities returned wrapped: `{product}`, `{accessory}`, `{address}`, `{user}`. Lists wrapped: `{products}`, `{accessories}`, `{users, page, pageSize, total}`, `{addresses}`, `{countries}`, `{states}`, `{cities}`.
- Admin `:id` in URLs is the numeric `id`. Admin entities expose `id, publicId, sku, slug (products), priceCents, active, stock, archivedAt`. Unknown or non-numeric `:id` → 404. Address `:id` is numeric `id`; another user's address → 404.
- `accessoryIds` everywhere are accessory `publicId` UUIDs.
- Dashboard: `{users, accessories, soldOut, products:{active, inactive}}`; archived rows not counted.
- Admin users rows: `id, name, email, verified, signInMethod ('password'|'google'|'both'), admin, createdAt`; never hashes or google id. Page size 25.
- Public product detail: `{product:{publicId, sku, name, slug, collection, colorway, description, priceCents, soldOut, images:[{url,isMain}], accessories:[{publicId,name,priceCents,soldOut,imageUrl}]}}`.
- Geo items `{code, name}`; countries/states/cities responses send `Cache-Control: public, max-age=86400`; missing required query params → 400.
- Upload response `{uploadUrl, key, publicUrl}`; key `products/<uuid>.(jpg|png|webp)`; accessory images use `accessories/<uuid>.<ext>`.
- `PUT images` is atomic (invalid → 400, nothing changes). 11th address → 400.
- Colorway: `corn/src/colorways.js` has only 3 (pastel, cream, autumn), not six. Decision: `colorway` is a free slug (1–40 chars, lowercase letters/digits/hyphen), NOT validated against a hardcoded list; the admin form suggests the ids from `colorways.js`.
- Admin product list and detail: each product includes `images:[{key, url, isMain}]` ordered by position (main first); list rows may carry the same array (thumbnail = main). Accessory rows carry `imageKey` and `imageUrl`.
- `POST /api/admin/uploads` body: `{contentType, size, kind?: 'product'|'accessory'}` (default `product`); key prefix `products/` or `accessories/` accordingly.
- Geo cities are `{name}` objects only (no code). Archived accessories are excluded from a product's `accessoryIds`.
