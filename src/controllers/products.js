import { COLLECTIONS } from '../lib/catalog.js';
import { parseOneOf } from '../lib/validate.js';
import * as catalog from '../services/catalog.js';

const list = async (req, res) => {
  const collection = req.query.collection === undefined ? undefined : parseOneOf('Collection', COLLECTIONS)(req.query.collection);
  res.json({ products: await catalog.listPublicProducts({ collection }) });
};

const get = async (req, res) => res.json({ product: await catalog.getPublicProduct(req.params.slug) });

export { list, get };
