const money = (cents) => `$${(cents / 100).toFixed(2)}`;

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

const addressLines = ({ fullName, line1, line2, city, stateCode, postalCode, countryCode }) =>
  [fullName, line1, line2, [city, stateCode, postalCode].filter(Boolean).join(' '), countryCode].filter(Boolean);

// Totals rows; shipping only appears when the order was charged for it.
const totalRows = (order) => [
  ['Subtotal', money(order.subtotalCents)],
  ...(order.shippingCents ? [['Shipping', money(order.shippingCents)]] : []),
  [`Tax (${order.taxRateBps / 100}%)`, money(order.taxCents)],
  ['Total', money(order.totalCents)],
];

// Branded confirmation for a placed order, as { subject, text, html }.
const orderConfirmationEmail = (order) => {
  const link = `${process.env.APP_URL}/orders/${order.orderNumber}`;
  const note = 'Payment instructions will follow in a separate email.';

  const text = [
    `Thank you for your order, ${order.address.fullName}!`,
    `Order ${order.orderNumber}`,
    '',
    ...order.items.flatMap((item) => [
      `${item.quantity} x ${item.name} (${item.sku}) - ${money(item.lineCents)}`,
      ...item.accessories.map((accessory) => `    + ${accessory.name} (${money(accessory.unitCents)})`),
    ]),
    '',
    ...totalRows(order).map(([label, value]) => `${label}: ${value}`),
    '',
    'Shipping to:',
    ...addressLines(order.address),
    '',
    note,
    `View your order: ${link}`,
  ].join('\n');

  const itemRows = order.items
    .map(
      (item) => `<tr><td style="padding:8px 0;border-bottom:1px solid #e8dfd2">${item.quantity} &times; ${escapeHtml(item.name)}${item.accessories
        .map((accessory) => `<br><span style="color:#7a6f64">+ ${escapeHtml(accessory.name)}</span>`)
        .join('')}</td><td style="padding:8px 0;border-bottom:1px solid #e8dfd2;text-align:right;vertical-align:top">${money(item.lineCents)}</td></tr>`,
    )
    .join('');
  const totals = totalRows(order)
    .map(([label, value]) => `<tr><td style="padding:2px 0;text-align:right">${escapeHtml(label)}</td><td style="padding:2px 0 2px 16px;text-align:right">${value}</td></tr>`)
    .join('');

  const html = `<div style="background:#f4eee4;padding:24px;font-family:Helvetica,Arial,sans-serif;color:#2b2622">
<div style="max-width:560px;margin:0 auto;background:#fffdf9;padding:32px;border-radius:12px">
<p style="margin:0 0 24px;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#b8893a">Glass Gem Farm</p>
<h1 style="margin:0 0 4px;font-size:22px">Thank you for your order</h1>
<p style="margin:0 0 24px;color:#7a6f64">Order ${escapeHtml(order.orderNumber)}</p>
<table style="width:100%;border-collapse:collapse">${itemRows}</table>
<table style="margin:16px 0 24px auto;border-collapse:collapse">${totals}</table>
<p style="margin:0 0 4px;font-weight:bold">Shipping to</p>
<p style="margin:0 0 24px;color:#7a6f64">${addressLines(order.address).map(escapeHtml).join('<br>')}</p>
<p style="margin:0 0 24px">${note}</p>
<a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 24px;border-radius:999px;background:#2b2622;color:#fffdf9;text-decoration:none">View your order</a>
</div></div>`;

  return { subject: `Your Glass Gem Farm order ${order.orderNumber}`, text, html };
};

export { orderConfirmationEmail };
