const COLLECTIONS = ['charms', 'pearls'];

// Most units of one product in a cart line (and the most the product page offers).
const MAX_ORDER_QUANTITY = 10;

// Live products: active and not archived. Unsold live ones are for sale; sold live ones fill the sold gallery.
const LIVE_PRODUCT = 'products.active = 1 AND products.archived_at IS NULL';
const BUYABLE_PRODUCT = `${LIVE_PRODUCT} AND products.sold = 0`;
const SOLD_PRODUCT = `${LIVE_PRODUCT} AND products.sold = 1`;

// Slugs that would be shadowed by fixed routes under /api/products.
const RESERVED_SLUGS = ['sold'];

export { COLLECTIONS, MAX_ORDER_QUANTITY, BUYABLE_PRODUCT, SOLD_PRODUCT, RESERVED_SLUGS };
