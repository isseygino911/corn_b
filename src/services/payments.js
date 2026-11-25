import Stripe from 'stripe';
import { pool } from '../db.js';

// The only file that talks to Stripe. Under NODE_ENV=test the API client is a recording stub (webhook signatures still use the real SDK).
const IS_TEST = process.env.NODE_ENV === 'test';
const CURRENCY = 'usd';
// Stock is held for 30 minutes; the extra minute keeps us above Stripe's 30-minute minimum despite clock drift.
const SESSION_SECONDS = 31 * 60;
const INTEGRATION_ID = 'corn-checkout-qzfrmtwk';

const stripeStub = { calls: [], failNext: false };
let stubIds = 0;
const record = (method, result) => async (params) => {
  stripeStub.calls.push({ method, params });
  if (stripeStub.failNext) {
    stripeStub.failNext = false;
    throw new Error('Stripe stub failure');
  }
  return result(params);
};
const fakeClient = {
  customers: {
    create: record('customers.create', () => ({ id: `cus_test_${++stubIds}` })),
    update: record('customers.update', () => ({})),
  },
  checkout: {
    sessions: {
      create: record('checkout.sessions.create', () => {
        const id = `cs_test_${++stubIds}`;
        return { id, url: `https://checkout.stripe.test/${id}` };
      }),
      expire: record('checkout.sessions.expire', () => ({})),
    },
  },
};

let client;
const stripe = () => (client ??= IS_TEST ? fakeClient : new Stripe(process.env.STRIPE_SECRET_KEY));

// One Stripe customer per user, carrying the chosen shipping address (shown on the Stripe payment).
const customerFor = async (user, address) => {
  const shipping = {
    name: address.fullName,
    phone: address.phone,
    address: {
      line1: address.line1,
      line2: address.line2 ?? undefined,
      city: address.city,
      state: address.stateCode,
      postal_code: address.postalCode,
      country: address.countryCode,
    },
  };
  const [[{ stripe_customer_id: id }]] = await pool.query('SELECT stripe_customer_id FROM users WHERE id = ?', [user.id]);
  if (id) {
    await stripe().customers.update(id, { shipping });
    return id;
  }
  const customer = await stripe().customers.create({ email: user.email, shipping });
  await pool.query('UPDATE users SET stripe_customer_id = ? WHERE id = ?', [customer.id, user.id]);
  return customer.id;
};

const lineItem = (name, unitAmount, quantity = 1) => ({
  quantity,
  price_data: { currency: CURRENCY, unit_amount: unitAmount, product_data: { name } },
});

// A hosted Checkout Session for a priced pending order: items, then shipping and our own tax as their own lines,
// so Stripe charges exactly the order total. Payment methods come from the Dashboard (no payment_method_types).
const createCheckout = async ({ user, address, order, priced }) => {
  const items = priced.lines.map((line) =>
    lineItem([line.product.name, ...line.accessories.map((accessory) => accessory.name)].join(' + '), line.unitCents, line.quantity),
  );
  if (priced.shippingCents) items.push(lineItem('Shipping', priced.shippingCents));
  if (priced.taxCents) items.push(lineItem(`Tax (${priced.taxRateBps / 100}%)`, priced.taxCents));
  return stripe().checkout.sessions.create(
    {
      mode: 'payment',
      customer: await customerFor(user, address),
      line_items: items,
      expires_at: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
      success_url: `${process.env.APP_URL}/orders/${order.orderNumber}?paid=1`,
      cancel_url: `${process.env.APP_URL}/checkout`,
      integration_identifier: INTEGRATION_ID,
    },
    { idempotencyKey: order.publicId },
  );
};

const expireCheckout = (sessionId) => stripe().checkout.sessions.expire(sessionId);

// Verifies the Stripe-Signature header against the raw body; throws on a bad signature.
const verifyEvent = (rawBody, signature) => Stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);

export { stripeStub, createCheckout, expireCheckout, verifyEvent };
