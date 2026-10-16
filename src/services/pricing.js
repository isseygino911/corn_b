import { HttpError } from '../lib/http.js';
import { getQuotable } from './catalog.js';

// The one place totals are computed. Integer cents; a client-sent total is never read.
const quote = async (slug, accessoryIds) => {
  const product = await getQuotable(slug);
  const chosen = accessoryIds.map((publicId) => {
    const accessory = product.accessories.find((candidate) => candidate.publicId === publicId);
    if (!accessory || accessory.soldOut) throw new HttpError(400, 'An accessory is not available for this product');
    return { publicId, name: accessory.name, priceCents: accessory.priceCents };
  });
  const totalCents = chosen.reduce((sum, accessory) => sum + accessory.priceCents, product.priceCents);
  return { productCents: product.priceCents, accessories: chosen, totalCents };
};

export { quote };
