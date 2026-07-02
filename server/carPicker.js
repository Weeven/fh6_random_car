const fs = require("fs");
const path = require("path");

const DATA_PATH = fs.existsSync(path.join(__dirname, "..", "data", "cars.json"))
  ? path.join(__dirname, "..", "data", "cars.json")
  : path.join(__dirname, "..", "data", "cars.sample.json");

let cars = [];

function loadCars() {
  cars = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  console.log(`Loaded ${cars.length} cars from ${path.basename(DATA_PATH)}`);
  return cars;
}

loadCars();

function isFilterEmpty(filters = {}) {
  return (
    !filters.classes?.length &&
    !filters.drivetrains?.length &&
    !filters.manufacturers?.length &&
    !filters.countries?.length &&
    !filters.decades?.length &&
    !filters.yearMin &&
    !filters.yearMax
  );
}

/**
 * filters shape:
 * {
 *   classes: ["S1", "S2"],        // OR within field
 *   drivetrains: ["RWD"],
 *   manufacturers: ["Honda"],
 *   countries: ["Japan"],
 *   decades: [1990, 2000],        // decade start years, e.g. 1990 = 1990-1999
 *   yearMin: 1990,                 // optional finer-grained range, combines with decades via AND
 *   yearMax: 2005
 * }
 * Empty/missing arrays = no restriction on that field.
 */
function applyFilters(filters = {}) {
  return cars.filter((car) => {
    if (filters.classes?.length && !filters.classes.includes(car.class)) return false;
    if (filters.drivetrains?.length && !filters.drivetrains.includes(car.drivetrain)) return false;
    if (filters.manufacturers?.length && !filters.manufacturers.includes(car.manufacturer)) return false;
    if (filters.countries?.length && !filters.countries.includes(car.country)) return false;
    if (filters.decades?.length) {
      if (!car.year) return false;
      const carDecade = Math.floor(car.year / 10) * 10;
      if (!filters.decades.includes(carDecade)) return false;
    }
    if (filters.yearMin && car.year && car.year < filters.yearMin) return false;
    if (filters.yearMax && car.year && car.year > filters.yearMax) return false;
    return true;
  });
}

function pickFromPool(pool) {
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Picks a random car matching the given filters.
 *
 * Special case: if NO filters are active at all (streamer selected nothing,
 * or a bare "!changecar" chat command with no suffix), we don't just grab
 * any of the 600+ cars uniformly — we first pick a random manufacturer, then
 * a random car from that manufacturer. Keeps results feeling curated rather
 * than fully chaotic, and gives every manufacturer roughly equal odds
 * regardless of how many cars they have in the game.
 */
function pickRandomCar(filters = {}) {
  if (isFilterEmpty(filters)) {
    const manufacturers = [...new Set(cars.map((c) => c.manufacturer).filter(Boolean))];
    if (manufacturers.length === 0) return { car: null, poolSize: 0 };
    const manufacturer = manufacturers[Math.floor(Math.random() * manufacturers.length)];
    const pool = cars.filter((c) => c.manufacturer === manufacturer);
    return { car: pickFromPool(pool), poolSize: pool.length, pickedManufacturer: manufacturer };
  }

  const pool = applyFilters(filters);
  return { car: pickFromPool(pool), poolSize: pool.length };
}

function getFacetOptions() {
  const classes = new Set();
  const drivetrains = new Set();
  const manufacturers = new Set();
  const countries = new Set();
  const decades = new Set();
  let yearMin = Infinity;
  let yearMax = -Infinity;

  for (const car of cars) {
    if (car.class) classes.add(car.class);
    if (car.drivetrain) drivetrains.add(car.drivetrain);
    if (car.manufacturer) manufacturers.add(car.manufacturer);
    if (car.country) countries.add(car.country);
    if (car.year) {
      decades.add(Math.floor(car.year / 10) * 10);
      yearMin = Math.min(yearMin, car.year);
      yearMax = Math.max(yearMax, car.year);
    }
  }

  return {
    classes: [...classes].sort(),
    drivetrains: [...drivetrains].sort(),
    manufacturers: [...manufacturers].sort(),
    countries: [...countries].sort(),
    decades: [...decades].sort((a, b) => a - b),
    yearRange: [yearMin === Infinity ? null : yearMin, yearMax === -Infinity ? null : yearMax],
    totalCars: cars.length,
  };
}

function normalizeToken(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Resolves a chat command suffix (e.g. "japan", "honda", "s1", "rwd", "90s")
 * into a filters object, by matching it against known facet values.
 * Returns { filters, matchedType, matchedValue } or { filters: {}, matchedType: null }
 * if nothing matched (caller should treat this like an empty/no-filter command).
 */
function resolveCommandToken(token) {
  if (!token) return { filters: {}, matchedType: null };

  const norm = normalizeToken(token);
  const facets = getFacetOptions();

  // Class, e.g. "s1", "a", "x" — check before country/manufacturer since these
  // are short and could otherwise false-match.
  const classMatch = facets.classes.find((c) => normalizeToken(c) === norm);
  if (classMatch) return { filters: { classes: [classMatch] }, matchedType: "class", matchedValue: classMatch };

  // Drivetrain
  const drivetrainMatch = facets.drivetrains.find((d) => normalizeToken(d) === norm);
  if (drivetrainMatch) {
    return { filters: { drivetrains: [drivetrainMatch] }, matchedType: "drivetrain", matchedValue: drivetrainMatch };
  }

  // Decade, e.g. "90s", "1990s", "1990"
  const decadeMatch = token.match(/^(\d{2}|\d{4})s?$/);
  if (decadeMatch) {
    let year = parseInt(decadeMatch[1], 10);
    if (year < 100) year = year < 30 ? 2000 + year : 1900 + year; // "90s" -> 1990, "10s" -> 2010
    const decade = Math.floor(year / 10) * 10;
    if (facets.decades.includes(decade)) {
      return { filters: { decades: [decade] }, matchedType: "decade", matchedValue: decade };
    }
  }

  // Country
  const countryMatch = facets.countries.find((c) => normalizeToken(c) === norm);
  if (countryMatch) return { filters: { countries: [countryMatch] }, matchedType: "country", matchedValue: countryMatch };

  // Manufacturer
  const manufacturerMatch = facets.manufacturers.find((m) => normalizeToken(m) === norm);
  if (manufacturerMatch) {
    return { filters: { manufacturers: [manufacturerMatch] }, matchedType: "manufacturer", matchedValue: manufacturerMatch };
  }

  return { filters: {}, matchedType: null };
}

module.exports = { loadCars, applyFilters, pickRandomCar, getFacetOptions, resolveCommandToken, isFilterEmpty };
