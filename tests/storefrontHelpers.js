import assert from 'node:assert/strict';
import { beforeEach } from 'node:test';
import Stripe from 'stripe';
import { idOf, setupSuite } from './helpers.js';

export const ADDRESS = {
  fullName: 'Ada Lovelace',
  phone: '555-0100',
  line1: '1 Main St',
  countryCode: 'US',
  stateCode: 'CA',
  city: 'Los Angeles',
  postalCode: '90001',
};
export const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000';

const WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
const signer = new Stripe('sk_test_x').webhooks;

const RESET_TABLES = ['order_item_accessories', 'order_items', 'orders', 'shipping_rates', 'settings'];

let eventSeq = 0;

// Flat 9.75% on the subtotal, rounded half up to the cent. Shipping is not taxed.
export const taxOf = (subtotalCents) => Math.floor((subtotalCents * 975 + 5000) / 10000);

// setupSuite plus storefront tables reset per test and helpers for settings, shipping, addresses, orders and Stripe.
// Absent `settings` rows must read as the defaults (shipping off).
export function setupStoreSuite() {
  const ctx = setupSuite();

  beforeEach(async () => {
    const { stripeStub } = await import('../src/services/payments.js');
    ctx.stripe = stripeStub;
    stripeStub.calls.length = 0;
    stripeStub.failNext = false;
    ctx.sessionIds = new Map();

    const conn = await ctx.pool.getConnection();
    try {
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');
      for (const table of RESET_TABLES) await conn.query(`TRUNCATE TABLE ${table}`);
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    } finally {
      conn.release();
    }
  });

  ctx.setSettings = async (cookie, body) => {
    const res = await ctx.call('PATCH', '/api/admin/settings', { cookie, body });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.settings;
  };

  ctx.addRate = async (cookie, body) => {
    const res = await ctx.call('POST', '/api/admin/shipping-rates', { cookie, body });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.shippingRate;
  };

  // Verified user with one saved address (the default). Returns { cookie, address }.
  // Clears the outbox so signup/verification mail never counts as order mail.
  ctx.userWithAddress = async (email = 'ada@example.com', address = {}) => {
    const cookie = await ctx.cookieFor(email);
    const res = await ctx.call('POST', '/api/account/addresses', { cookie, body: { ...ADDRESS, ...address } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    ctx.outbox.length = 0;
    return { cookie, address: res.body.address };
  };

  // Admin, a $2 accessory (stock 10), a $10 product (stock 5) allowing it, and a buyer with an address.
  ctx.orderFixture = async () => {
    const admin = await ctx.adminCookie();
    const hook = await ctx.makeAccessory(admin, { name: 'Hook', priceCents: 200, stock: 10 });
    const charm = await ctx.makeProduct(admin, { name: 'Charm', priceCents: 1000, stock: 5, accessoryIds: [hook.publicId] });
    const buyer = await ctx.userWithAddress('ada@example.com');
    return { admin, hook, charm, ...buyer };
  };

  // Remembers the Stripe session of each order so tests can pay it through the webhook.
  ctx.placeOrder = async (cookie, items, address, extra = {}) => {
    const res = await ctx.call('POST', '/api/orders', { cookie, body: { items, addressId: idOf(address), ...extra } });
    if (res.status === 201) ctx.sessionIds.set(res.body.order.orderNumber, res.body.checkoutUrl.split('/').pop());
    return res;
  };

  // Posts the exact signed payload. `signature`: undefined = valid, null = header omitted, string = as given.
  ctx.postWebhook = async (event, { signature } = {}) => {
    const payload = JSON.stringify(event);
    const header = signature === undefined ? signer.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }) : signature;
    const res = await fetch(`${ctx.base}/api/stripe/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(header === null ? {} : { 'stripe-signature': header }) },
      body: payload,
    });
    await res.text();
    return res.status;
  };

  // The event's amounts default to the order's own; `taxCents` overrides Stripe's reported tax.
  ctx.sessionEvent = (type, order, { paymentStatus = 'paid', taxCents = order.taxCents, sessionId = ctx.sessionIds.get(order.orderNumber) } = {}) => ({
    id: `evt_${++eventSeq}`,
    type,
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        payment_status: paymentStatus,
        amount_total: order.totalCents - order.taxCents + taxCents,
        total_details: { amount_tax: taxCents },
      },
    },
  });

  ctx.payOrder = async (order, options) => {
    const status = await ctx.postWebhook(ctx.sessionEvent('checkout.session.completed', order, options));
    assert.equal(status, 200);
  };

  // Places an order and pays it; returns the order as the customer now sees it.
  ctx.placePaid = async (cookie, items, address) => {
    const res = await ctx.placeOrder(cookie, items, address);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    await ctx.payOrder(res.body.order);
    return (await ctx.call('GET', `/api/orders/${res.body.order.orderNumber}`, { cookie })).body.order;
  };

  ctx.stockOf = async (table, entity) => (await ctx.row(`SELECT stock FROM ${table} WHERE id = ?`, [idOf(entity)])).stock;

  return ctx;
}

export const line = (product, quantity = 1, accessories = []) => ({
  slug: product.slug,
  accessoryIds: accessories.map((a) => a.publicId),
  quantity,
});
