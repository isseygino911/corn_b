import { HttpError } from '../lib/http.js';
import * as orders from '../services/orders.js';
import { verifyEvent } from '../services/payments.js';

// Payment state changes come only from signed Stripe events, never from the success page.
const webhook = async (req, res) => {
  let event;
  try {
    event = verifyEvent(req.body, req.headers['stripe-signature']);
  } catch (error) {
    // A wrong STRIPE_WEBHOOK_SECRET fails every delivery here, so make it visible in the logs.
    console.error('Stripe webhook rejected:', error.message);
    throw new HttpError(400, 'Invalid Stripe signature');
  }
  const session = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed':
      // Delayed payment methods complete unpaid and confirm later through async_payment_succeeded.
      if (session.payment_status === 'unpaid') break;
    // falls through
    case 'checkout.session.async_payment_succeeded':
      await orders.markPaid(session.id);
      break;
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed':
      await orders.discardSession(session.id);
      break;
  }
  res.json({ received: true });
};

export { webhook };
