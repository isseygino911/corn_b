import { COLLECTIONS } from '../lib/catalog.js';
import { HttpError } from '../lib/http.js';
import { parseOneOf, parsePage } from '../lib/validate.js';
import * as catalog from '../services/catalog.js';

const list = async (req, res) => {
  const collection = req.query.collection === undefined ? undefined : parseOneOf('Collection', COLLECTIONS)(req.query.collection);
  res.json({ products: await catalog.listPublicProducts({ collection }) });
};

// The visitor's month ("YYYY-MM") seeds the gallery order, so it changes with their calendar. Defaults to the server's month.
const parseMonth = (value = new Date().toISOString().slice(0, 7)) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new HttpError(400, 'Month must look like 2026-11');
  return value;
};

const sold = async (req, res) =>
  res.json(await catalog.listSoldProducts({ month: parseMonth(req.query.month), page: parsePage(req.query.page) }));

const get = async (req, res) => res.json({ product: await catalog.getPublicProduct(req.params.slug) });

export { list, sold, get };
