import { City, Country, State } from 'country-state-city';
import { HttpError } from '../lib/http.js';

const countries = () => Country.getAllCountries().map(({ isoCode, name }) => ({ code: isoCode, name }));

const requireCountry = (countryCode) => {
  if (!Country.getCountryByCode(countryCode)) throw new HttpError(400, 'Unknown country');
};

const states = (countryCode) => {
  requireCountry(countryCode);
  return State.getStatesOfCountry(countryCode).map(({ isoCode, name }) => ({ code: isoCode, name }));
};

const cities = (countryCode, stateCode) => {
  requireCountry(countryCode);
  if (!State.getStateByCodeAndCountry(stateCode, countryCode)) throw new HttpError(400, 'Unknown state');
  return City.getCitiesOfState(countryCode, stateCode).map(({ name }) => ({ name }));
};

// Checks the country exists and the state belongs to it. Countries without states take an empty state code.
const assertRegion = (countryCode, stateCode) => {
  requireCountry(countryCode);
  const hasStates = State.getStatesOfCountry(countryCode).length > 0;
  if (hasStates ? !State.getStateByCodeAndCountry(stateCode, countryCode) : stateCode !== '') {
    throw new HttpError(400, 'Unknown state');
  }
};

export { countries, states, cities, assertRegion };
