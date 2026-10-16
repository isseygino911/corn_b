import { parseCartItems, parseString, text } from '../lib/validate.js';
import { assertCountry } from '../services/geo.js';
import { quote } from '../services/pricing.js';
import { getSettings } from '../services/settings.js';

const parseCountryCode = (value) => {
  const code = parseString('Country', 2)(value).toUpperCase();
  assertCountry(code);
  return code;
};

const getStorefrontSettings = async (req, res) => res.json(await getSettings());

const createQuote = async (req, res) => {
  // The country is only looked at when shipping is on, so it is not validated here.
  res.json(await quote(parseCartItems(req.body?.items), text(req.body?.countryCode).trim().toUpperCase()));
};

export { parseCountryCode, getStorefrontSettings, createQuote };
