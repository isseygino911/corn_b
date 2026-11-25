import { HttpError } from '../lib/http.js';
import { parseCartItems, parseFields, parseNumericId, parseOneOf, parsePage, text } from '../lib/validate.js';
import * as orders from '../services/orders.js';

// Customers never see row ids; admins do.
const ownView = ({ id, userId, ...order }) => order;

const place = async (req, res) => {
  const addressId = req.body?.addressId;
  if (!Number.isInteger(addressId) || addressId < 1) throw new HttpError(400, 'addressId is required');
  const { order, checkoutUrl } = await orders.place(req.user, { items: parseCartItems(req.body?.items), addressId });
  res.status(201).json({ order: ownView(order), checkoutUrl });
};

const list = async (req, res) => res.json({ orders: (await orders.listForUser(req.user.id)).map(ownView) });

const get = async (req, res) => res.json({ order: ownView(await orders.getForUser(req.user.id, req.params.orderNumber)) });

const adminList = async (req, res) => {
  const status = req.query.status === undefined ? undefined : parseOneOf('Status', orders.STATUSES)(req.query.status);
  res.json(await orders.listAll({ status, q: text(req.query.q).trim(), page: parsePage(req.query.page) }));
};

const adminGet = async (req, res) => res.json({ order: await orders.get(parseNumericId(req.params.id)) });

const adminSetStatus = async (req, res) => {
  const { status } = parseFields(req.body, { status: parseOneOf('Status', orders.STATUSES) });
  res.json({ order: await orders.setStatus(parseNumericId(req.params.id), status) });
};

export { place, list, get, adminList, adminGet, adminSetStatus };
