import { text } from '../lib/validate.js';
import * as geo from '../services/geo.js';

const DAY_SECONDS = 24 * 60 * 60;

const cached = (res, body) => {
  res.set('Cache-Control', `public, max-age=${DAY_SECONDS}`);
  res.json(body);
};

const countries = (req, res) => cached(res, { countries: geo.countries() });

const states = (req, res) => cached(res, { states: geo.states(text(req.query.country)) });

const cities = (req, res) => cached(res, { cities: geo.cities(text(req.query.country), text(req.query.state)) });

export { countries, states, cities };
