# Slice 3 — UI kit (shadcn/ui, React Bits, motion), cart, checkout, orders, tax, shipping

Backend `corn_b` + UI in `../corn`. Agreed with the owner in a grilling session; do not widen scope.
Out of scope: payment (next slice), refunds, discounts, free-shipping threshold, guest checkout, resend-email button, admin email notifications.

## Rules
- Same conventions as `auth.md` / `panels.md`. Work on `main` (no worktree). Never `git commit`/`push` unless asked. Never commit `.env`.
- Landing page is isolated and untouched: no Tailwind, no shadcn, no `motion` there; its CSS and GSAP stay as they are.
  Verify pixel-identical at 390px and desktop after every step.
- New dependencies, approved by the owner (`corn`): `tailwindcss`, `@tailwindcss/vite`, shadcn/ui deps (`clsx`, `tailwind-merge`,
  `class-variance-authority`, `lucide-react`, Radix packages as the components need them, `sonner`), `motion`. Pin exact versions,
  check current docs (Context7) first. Nothing else. No TanStack Table, no cart/state library.
- Plain JS/JSX (shadcn `tsx: false`).

## UI kit (frontend)
- Scope: panels (`/account`, `/admin`), shop, product page, cart drawer, checkout, order pages. Auth pages stay as they are.
- Tailwind v4 is imported only from the lazy panel/shop entry, with no preflight, so nothing leaks into the landing page.
- shadcn theme variables map to the existing tokens (bone, rose, ink, gold); Geist / Geist Mono; pill buttons and mono uppercase labels as variants.
- Components: Button, Input, Label, Textarea, Select, Checkbox, Switch, Table, Dialog, Sheet, Sonner, Badge, Tabs, Skeleton, Pagination.
  Tables keep collapsing to labelled cards on phones.
- React Bits (GSAP/CSS/`motion` flavours, no WebGL) on the shop grid, product page and panels (e.g. dashboard count-up, card hover, staggered reveal,
  animated total). Honour `prefers-reduced-motion`. Usable at 390 px.

## Cart (frontend only)
- Cart is a React context persisted in `localStorage` (like `AuthContext`), no library. Lines: product `publicId`, accessory `publicId`s, quantity.
  Same product + same accessory set merges into one line. Quantity 1..min(stock, 10).
- Cart icon with count badge only on shop, product, checkout, order and panel pages (not the landing nav). Click opens a shadcn `Sheet` drawer with
  animated lines, subtotal, "Shipping and tax at checkout", and a Checkout button. No `/cart` page.
- Product page: "Add to cart" replaces the "no cart yet" note.
- Prices shown client-side are estimates; the server reprices everything.

## Settings and shipping (backend)
- `settings` table (key/value): `tax_rate_bps` (default 925 = 9.25%), `shipping_enabled` (default 0).
- `shipping_rates`: `id`, `country_code` CHAR(2) NULL UNIQUE (NULL = default row for any other country), `price_cents` INT UNSIGNED, `active` BOOL.
  Hard delete (pure config). Country codes validated against `country-state-city`.
- Shipping off: shipping = $0 and hidden everywhere. On: price from the country row, else the default row, else the order is rejected
  ("We don't ship there yet").
- `services/pricing.js` stays the single place for totals: `subtotal = Σ(product + accessories) × qty`; `tax = round(subtotal × bps / 10000)`
  (nearest cent, shipping not taxed); `total = subtotal + shipping + tax`.
- Public `GET /api/settings/storefront` → `{taxRateBps, shippingEnabled}`. The existing `POST /api/products/:slug/quote` is replaced/extended by
  `POST /api/checkout/quote` taking `{items:[{slug, accessoryIds, quantity}], countryCode?}` → lines, `subtotalCents`, `shippingCents`, `taxCents`, `totalCents`.
- Admin (`requireAdmin`): `GET/PATCH /api/admin/settings` (`taxRateBps` 0–5000, `shippingEnabled`), `GET/POST/PATCH/DELETE /api/admin/shipping-rates`.

## Orders (backend)
- `orders`: `id`, `public_id` UUID, `order_number` UNIQUE (`GGF-000123`), `user_id` FK, `email`, `status` ENUM('placed','shipped','delivered','cancelled') default 'placed',
  shipping address snapshot columns (full_name, phone, line1, line2, country_code, state_code, city, postal_code),
  `subtotal_cents`, `shipping_cents`, `tax_rate_bps`, `tax_cents`, `total_cents`, `placed_at`, `status_updated_at`.
- `order_items`: `order_id` FK CASCADE, product snapshot (`product_id` nullable, `sku`, `name`, `unit_cents`, `quantity`, `image_key`), `line_cents`.
- `order_item_accessories`: `order_item_id` FK CASCADE, snapshot (`accessory_id` nullable, `sku`, `name`, `unit_cents`).
  Snapshots mean later edits or archiving never change history.
- Place order: `POST /api/orders` (`requireUser`) `{items, addressId}` (own saved address, 404 for others'). One transaction: re-validate and re-price
  (client totals never trusted), lock product/accessory rows `FOR UPDATE`, reject over-stock (409, which item), decrement stock, insert snapshots.
  Returns `{order}`; the client then redirects to `/orders/:orderNumber`.
- `GET /api/orders` (own, newest first), `GET /api/orders/:orderNumber` (own only; others' → 404).
- Admin: `GET /api/admin/orders?status=&q=&page=`, `GET /api/admin/orders/:id`, `PATCH /api/admin/orders/:id/status` (placed→shipped→delivered; cancel allowed from
  placed or shipped; cancel restores stock in a transaction; invalid transition → 409).
- Email: after commit, send the confirmation through the existing nodemailer service (`services/mail`), branded HTML + text fallback: order number, items,
  accessories, subtotal / shipping / tax / total, shipping address, link to `/orders/:orderNumber`, note that payment instructions follow.
  A send failure is logged and never fails the order. Customer only.

## Frontend pages
- `/checkout` (signed in, else `/login` and back; cart survives): saved-address picker or new address (geo dropdowns as in the account panel),
  order summary from `/api/checkout/quote` recomputed when the address changes, "Place order".
- `/orders/:orderNumber`: items, address, totals, status timeline. `/account/orders` replaces the empty state with the list.
- Admin: Orders (list, detail, status dropdown, cancel) and Settings (tax rate, shipping toggle, shipping-rates table).

## Order of work (each step ends with `npm test` green and `npm run build` clean; browser check at 390 px and desktop; landing identical)
1. Lead: Tailwind + shadcn setup, theme tokens, shared components, isolation check. In parallel, `backend-builder` (+ `tester` first, per `/team-build`):
   settings, shipping_rates, pricing, quote, orders, stock transaction, email, tests.
2. After step 1 lands, two named frontend teammates (one owner per file): `panels-ui` migrates `/account` + `/admin` to shadcn and adds Orders/Settings admin;
   `shop-ui` migrates the shop and product page and builds cart drawer, checkout and order pages.
3. React Bits / `motion` polish on shop, product page and panels.
4. `verify-app` in the browser, then `code-review`. No commit unless asked.

## Open items for the owner
- Production tax rate and shipping prices (placeholders until set in the admin Settings screen).
- Payment slice (next): where payment status and the "payment instructions" email content come from.

## Pinned shapes (added by tester; binding for backend and tests in `tests/settings|checkout|orders|admin-orders.test.js`)
- Errors are `{error: message}`. `settings` rows may be absent: absent reads as the defaults (925 bps, shipping off). Tests truncate `settings`, `shipping_rates`, `orders`, `order_items`, `order_item_accessories` between tests.
- Settings: `GET/PATCH /api/admin/settings` → `{settings:{taxRateBps, shippingEnabled}}`; PATCH is partial; `taxRateBps` must be an integer 0–5000, `shippingEnabled` a boolean, else 400 and nothing changes.
- Shipping rate entity `{id, countryCode|null, priceCents, active}`: `POST` → 201 `{shippingRate}` (`active` defaults true; `countryCode` upper-cased, must be a real ISO code, omitted/null = default row; `priceCents` integer ≥ 0 required); list `{shippingRates}`;
  `PATCH /:id` (any of `countryCode, priceCents, active`) → `{shippingRate}`; `DELETE /:id` → 204. Duplicate country or a second default row → 409; bad values → 400; unknown id → 404.
- `POST /api/checkout/quote` (public) → 200 `{lines:[{slug, name, quantity, unitCents, lineCents, accessories:[{publicId, name, priceCents}]}], subtotalCents, shippingCents, taxCents, totalCents}`.
  `quantity` must be an integer ≥ 1 and `items` non-empty, else 400. Unknown/inactive/archived product → 404. Accessory sold out/inactive/archived/not allowed/unknown/malformed → 400.
  Shipping on and no active country row and no active default row, or `countryCode` missing → 400 `We don't ship there yet`. Shipping off ignores `countryCode`. Inactive rates are ignored.
- Order (own view) `{orderNumber ('GGF-' + 6 digits, increasing), publicId, status, email, subtotalCents, shippingCents, taxRateBps, taxCents, totalCents, placedAt, statusUpdatedAt,
  address:{fullName, phone, line1, line2|null, countryCode, stateCode, city, postalCode}, items:[{sku, name, unitCents, quantity, imageKey, lineCents, accessories:[{sku, name, unitCents}]}]}`.
  Admin detail is the same object plus numeric `id`.
- `POST /api/orders {items, addressId}` → 201 `{order}`. Product problems as the quote (404); accessory problems 400; no shipping rate 400; empty items, bad quantity or missing `addressId` 400; unknown or another user's address 404;
  over-stock 409 with the product or accessory name in `error`. Stock is decremented per unit ordered for the product and for each chosen accessory (accessory × quantity). Any failure leaves no rows and no stock change.
- `GET /api/orders` → `{orders:[{orderNumber, status, totalCents, placedAt, ...}]}` (newest first, own only, may be the full order shape). `GET /api/orders/:orderNumber` → `{order}`; others' or unknown → 404.
- Confirmation email: one mail to the customer's email, `subject` contains the order number, both `text` and `html`, containing order number, item and accessory names, address line1, subtotal as dollars (e.g. `12.00`),
  `${APP_URL}/orders/<orderNumber>`, and the word "payment". Sent after commit; none on rejected orders; a throwing mailer does not fail the order (tests make `outbox.push` throw).
- Admin: `GET /api/admin/orders?status=&q=&page=` → `{orders:[{id, orderNumber, status, email, totalCents, placedAt}], page, pageSize: 25, total}` newest first; `q` matches order number or email substring; unknown `status` → 400.
  `GET /api/admin/orders/:id` → `{order}`; unknown or non-numeric id → 404. `PATCH /api/admin/orders/:id/status {status}` → 200 `{order}`; unknown/missing status 400; unknown order 404;
  allowed: placed→shipped, shipped→delivered, placed|shipped→cancelled (restores product and accessory stock, even for archived rows); everything else, including cancelled→anything, is 409 and changes nothing.
