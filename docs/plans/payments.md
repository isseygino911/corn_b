# Slice 4 — Payments + Tax (Stripe hosted Checkout)

Agreed 2026-11-25. **Change (same day): Stripe Tax dropped — tax is a flat 9.75% (`TAX_RATE_BPS` in `services/pricing.js`), shown to Stripe as a "Tax (9.75%)" line item.** Stripe Tax notes below are kept only for a possible later switch.
 Decisions: `stripe@23.0.0` approved; "Tax calculated at payment" text before paying (no live estimate);
unpaid orders hold stock 30 min; USD only. Owner asked to keep it simple.
Backend `corn_b` + small UI changes in `../corn`. Same rules as `storefront.md` (work on `main`, no commit/push unless asked, never commit `.env`).

## Shape (from the Stripe implementation planner, sandbox `corn sandbox` acct_1UfV25LcsWWL5Vlz)
- Stripe only, web, physical goods, one-time payments → **Checkout Sessions, hosted (redirect) page**. Lowest maintenance; full order
  summary, Link, Apple/Google Pay come for free. Our `/checkout` page (address picker + quote) stays; "Place order" becomes "Pay".
- **Dynamic payment methods**: never pass `payment_method_types`; choose methods in Dashboard → Settings → Payment methods. Turn on Link and Adaptive Pricing there.
- **Stripe Tax** via `automatic_tax: { enabled: true }` replaces the flat `tax_rate_bps` setting.
- Fulfillment only from **signed webhooks**, never from the success page.
- SDK `stripe` (Node) 23.0.0, pinned exact, API version `2026-09-30.endive` set on the client. One `new Stripe(key, { apiVersion })` instance in
  `services/payments.js`: the only file that imports Stripe, stubbed under `NODE_ENV=test` like `services/storage.js`.

## Keys (`.env`, placeholders already added)
- `STRIPE_SECRET_KEY` — prefer a restricted key (`rk_test_…` locally): write Checkout Sessions + Customers. No publishable key needed (hosted redirect).
- `STRIPE_WEBHOOK_SECRET` — `whsec_…`. Local: `stripe listen --forward-to localhost:3009/api/stripe/webhook`. Prod endpoint
  `https://corn-api.iidesign.cloud/api/stripe/webhook`, events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `checkout.session.expired`.

## Tax prerequisites (owner, Dashboard — verified state of the sandbox on 2026-11-25)
- Tax settings `status: pending`, missing `head_office`; **0 registrations**. Until both exist Stripe silently collects $0 tax.
  1. Dashboard → Tax → Settings: set head office address (sandbox now, live before launch — sandbox settings don't carry over).
  2. Dashboard → Tax → Locations: add a registration for each jurisdiction you're already registered in (with your tax advisor). Watch "Needs attention" for thresholds.
- Tax codes (verified via Tax Codes API): products/accessories `txcd_99999999` General – Tangible Goods; shipping `txcd_92010001` Shipping.
  Confirm these fit glass-gem corn ornaments with your advisor ([tax code list](https://docs.stripe.com/tax/tax-codes)).
- After setup, the builder runs a test Tax Calculation for a registered-jurisdiction address and checks `taxability_reason` ≠ `not_collecting`.

## Backend (as built)
- Migration `006_payments.sql`: `orders.status` gains `pending_payment` (default); `placed` now means **paid**. `orders.stripe_session_id`,
  `users.stripe_customer_id`. `tax_rate_bps` setting deleted; `orders.tax_rate_bps` NULL-able history, no longer in the API.
- `services/payments.js` — the only Stripe file (recording stub `stripeStub` under `NODE_ENV=test`). One customer per user with the chosen
  shipping address (Stripe Tax uses it). Session: `mode: 'payment'`, price_data line items (`tax_behavior: 'exclusive'`, goods tax code),
  shipping as one more line item (shipping tax code), `automatic_tax`, `expires_at` +31 min (Stripe's minimum is 30), `integration_identifier`,
  idempotency key = order `public_id`. No `payment_method_types`.
- `POST /api/orders` → `{ order, checkoutUrl }`: discards the user's earlier unpaid orders (expires their sessions), holds stock in the same
  transaction as before with tax 0, then creates the session. Stripe failure → order discarded, 502.
- `POST /api/stripe/webhook` (raw body, mounted before `express.json()`): `completed` (unless `unpaid`) / `async_payment_succeeded` →
  `placed` with Stripe's tax and total + confirmation email; `expired` / `async_payment_failed` → unpaid order **deleted**, stock restored.
  Guarded on `status = 'pending_payment'`, so redeliveries are no-ops.
- Admin can't move a `pending_payment` order; it resolves by webhook. Cancelling a paid order does not refund — refund in the Stripe Dashboard.

## Frontend (as built)
- Checkout "Pay" → redirect to Stripe; cart kept until the customer comes back with `?paid=1`. Summary tax row: "Calculated at payment".
- Order page: "Awaiting payment" badge; on `?paid=1` it re-checks every 2 s (up to 30 s) until the webhook marks it paid.
- Admin settings: tax-rate field removed. Orders tab "pending payment".

## Tests (`qa-test` first, per `/team-build`)
- Webhook: bad signature 400; completed+paid → placed + tax written + email once; redelivery no-op; completed+unpaid ignored; expired → cancelled + stock restored.
- Orders: place returns `checkoutUrl`, status `pending_payment`, session params (no `payment_method_types`, `automatic_tax` on, tax codes, exclusive behavior).

## Order of work (each step: `npm test` green, `npm run build` clean)
1. Owner: approve dependency, settle decisions, fill `.env`, Tax head office + registrations.
2. tester → backend-builder: migration, payments service, orders/webhook, settings cleanup.
3. frontend teammate: checkout/order/admin changes.
4. Local end-to-end with `stripe listen` + test card 4242…; tax calculation check; `verify-app`, then `code-review`.
