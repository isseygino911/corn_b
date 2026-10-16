import { COLLECTIONS } from '../lib/catalog.js';
import { HttpError } from '../lib/http.js';
import { parseOneOf, parseUuidList } from '../lib/validate.js';
import * as catalog from '../services/catalog.js';
import { quote } from '../services/pricing.js';

const list = async (req, res) => {
  const collection = req.query.collection === undefined ? undefined : parseOneOf('Collection', COLLECTIONS)(req.query.collection);
  res.json({ products: await catalog.listPublicProducts({ collection }) });
};

const get = async (req, res) => res.json({ product: await catalog.getPublicProduct(req.params.slug) });

const createQuote = async (req, res) => {
  if (req.body?.accessoryIds === undefined) throw new HttpError(400, 'accessoryIds is required');
  res.json(await quote(req.params.slug, parseUuidList('Accessory')(req.body.accessoryIds)));
};

export { list, get, createQuote };
