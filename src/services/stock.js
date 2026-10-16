import { HttpError } from '../lib/http.js';

const add = (map, row, quantity) => map.set(row.id, { row, quantity: (map.get(row.id)?.quantity ?? 0) + quantity });

// Units wanted per product and per accessory across lines [{ product, accessories, quantity }]: Map(id -> { row, quantity }).
const tally = (lines) => {
  const demand = { products: new Map(), accessories: new Map() };
  for (const { product, accessories, quantity } of lines) {
    add(demand.products, product, quantity);
    accessories.forEach((accessory) => add(demand.accessories, accessory, quantity));
  }
  return demand;
};

// Rejects with 409 naming the first item the locked rows cannot cover.
const assertStock = (demand) => {
  for (const { row, quantity } of [...demand.products.values(), ...demand.accessories.values()]) {
    if (row.stock < quantity) {
      const message = row.stock === 0 ? `${row.name} is sold out` : `Only ${row.stock} of ${row.name} left`;
      throw new HttpError(409, message, { code: 'out_of_stock', sku: row.sku });
    }
  }
};

// Moves stock by `sign` (-1 sells, +1 restores). Rows go in id order, products first, so concurrent orders cannot deadlock.
const applyStock = async (connection, demand, sign) => {
  for (const [table, map] of [['products', demand.products], ['accessories', demand.accessories]]) {
    for (const id of [...map.keys()].sort((a, b) => a - b)) {
      await connection.query(`UPDATE ${table} SET stock = stock + ? WHERE id = ?`, [sign * map.get(id).quantity, id]);
    }
  }
};

export { tally, assertStock, applyStock };
