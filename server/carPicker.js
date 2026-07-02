const fs = require("fs");
const path = require("path");

const DATA_PATH = fs.existsSync(path.join(__dirname, "..", "data", "cars.json"))
  ? path.join(__dirname, "..", "data", "cars.json")
  : path.join(__dirname, "..", "data", "cars.sample.json");
const COUNTRY_CONTINENTS_PATH = path.join(__dirname, "..", "data", "country_continents.json");

const countryContinents = JSON.parse(fs.readFileSync(COUNTRY_CONTINENTS_PATH, "utf8"));

let cars = [];

function loadCars() {
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  cars = raw.map((car) => ({ ...car, region: countryContinents[car.country] || "Unknown" }));
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
    !filters.regions?.length &&
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
 *   regions: ["Asia"],
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
    if (filters.regions?.length && !filters.regions.includes(car.region)) return false;
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

const FILTER_KEYS = ["manufacturers", "decades", "classes", "drivetrains", "countries", "regions"];
// Order dropped in when a combo is too narrow — most-specific/most-narrowing first.
const MIN_POOL_SIZE = 6; // reveals must match MORE than 5 cars — otherwise chat/the streamer may not own one

function activeFilterKeys(filters) {
  return FILTER_KEYS.filter((key) => filters[key]?.length);
}

function labelForFilters(filters) {
  const parts = [];
  if (filters.regions?.length) parts.push(filters.regions.join("/"));
  if (filters.countries?.length) parts.push(filters.countries.join("/"));
  if (filters.manufacturers?.length) parts.push(filters.manufacturers.join("/"));
  if (filters.classes?.length) parts.push(`Class ${filters.classes.join("/")}`);
  if (filters.drivetrains?.length) parts.push(filters.drivetrains.join("/"));
  if (filters.decades?.length) parts.push(filters.decades.map((d) => `${d}s`).join("/"));
  return parts.join(" · ");
}

function randomManufacturerResult() {
  const manufacturers = [...new Set(cars.map((c) => c.manufacturer).filter(Boolean))];
  const manufacturer = manufacturers[Math.floor(Math.random() * manufacturers.length)];
  return { label: manufacturer, manufacturer, poolSize: cars.length, narrowed: false };
}

/**
 * Drops filter dimensions (in FILTER_KEYS priority order, most-specific
 * first) until the pool is bigger than MIN_POOL_SIZE - 1.
 *
 * keepAtLeastOneFilter=true preserves a single manually-chosen filter even
 * if it's narrow (e.g. a user deliberately picking "Volvo" even though they
 * only have 1 car) — used for the control-panel/chat spin. Set to false for
 * fully machine-generated filter combos, which have no "deliberate choice"
 * to protect and should broaden all the way down to nothing if needed.
 */
function broadenPool(filters, { keepAtLeastOneFilter }) {
  let active = { ...filters };
  let pool = applyFilters(active);

  while (pool.length < MIN_POOL_SIZE) {
    const remaining = activeFilterKeys(active);
    if (remaining.length === 0) break;
    if (keepAtLeastOneFilter && remaining.length <= 1) break;
    const keyToDrop = FILTER_KEYS.find((key) => active[key]?.length);
    active = { ...active, [keyToDrop]: [] };
    pool = applyFilters(active);
  }

  return { active, pool };
}

/**
 * Reveals exactly as much as the active filters pin down — never a specific
 * car model. The idea: only show what was actually asked for, and roll dice
 * only for whatever wasn't specified.
 *
 *   no filters at all         -> roll a random manufacturer (equal odds each,
 *                                 so a 1-car manufacturer like Volvo isn't
 *                                 drowned out by Ford's 30, and isn't a
 *                                 "celebrity result" either)
 *   exactly one filter         -> show it as-is, however narrow (you picked
 *                                 it on purpose, e.g. "Volvo" even if they
 *                                 only have 1 car)
 *   two or more filters        -> show them combined ("Nissan · Class A"),
 *                                 UNLESS that combo matches MIN_POOL_SIZE-1
 *                                 or fewer cars — then drop the most-specific
 *                                 filter in the combo and recheck, repeating
 *                                 until the pool is bigger or only one filter
 *                                 is left (e.g. "Class D" + "Japan" + "Nissan"
 *                                 with ~1 match backs off to "Japan · Class D")
 */
function computeSpinResult(filters = {}) {
  const { active, pool } = broadenPool(filters, { keepAtLeastOneFilter: true });

  if (isFilterEmpty(active)) return randomManufacturerResult();

  return {
    label: labelForFilters(active),
    manufacturer: active.manufacturers?.length === 1 ? active.manufacturers[0] : null,
    poolSize: pool.length,
    narrowed: activeFilterKeys(active).length < activeFilterKeys(filters).length,
  };
}

/**
 * Generates a fully random filter combo (0-2 random dimensions, e.g. "region
 * + decade" or "drivetrain + country" or just one manufacturer) for the
 * overlay's "refresh the page for something random" feature. Always broadens
 * down to a bigger pool (or all the way to a random manufacturer) if the
 * random combo turns out too narrow — there's no user intent to preserve
 * here, unlike computeSpinResult.
 *
 * Unlike computeSpinResult's equal-odds-per-manufacturer fallback, this
 * favors whichever values have more cars behind them — sampled by picking
 * one uniformly random CAR and reading its attributes off, rather than
 * picking uniformly among each dimension's unique values. A manufacturer
 * with 30 cars is proportionally more likely to come up than one with 1,
 * so a refresh is more likely to land on something with enough matches that
 * whoever's watching actually owns one (e.g. "Ford" over "Aston Martin").
 */
function computeRandomSpin() {
  const sourceCar = cars[Math.floor(Math.random() * cars.length)];
  const sourceDecade = sourceCar.year ? Math.floor(sourceCar.year / 10) * 10 : null;

  const dimensionValues = {
    manufacturers: sourceCar.manufacturer,
    decades: sourceDecade,
    classes: sourceCar.class,
    drivetrains: sourceCar.drivetrain,
    countries: sourceCar.country,
    regions: sourceCar.region,
  };

  const availableKeys = FILTER_KEYS.filter((key) => dimensionValues[key] != null);
  for (let i = availableKeys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [availableKeys[i], availableKeys[j]] = [availableKeys[j], availableKeys[i]];
  }

  const dimensionCount = Math.floor(Math.random() * 3); // 0, 1, or 2 dimensions
  const filters = {};
  for (const key of availableKeys.slice(0, dimensionCount)) {
    filters[key] = [dimensionValues[key]];
  }

  const { active, pool } = broadenPool(filters, { keepAtLeastOneFilter: false });
  if (isFilterEmpty(active)) {
    return { label: sourceCar.manufacturer, manufacturer: sourceCar.manufacturer, poolSize: cars.length, narrowed: false };
  }

  return {
    label: labelForFilters(active),
    manufacturer: active.manufacturers?.length === 1 ? active.manufacturers[0] : null,
    poolSize: pool.length,
    narrowed: true,
  };
}

function getFacetOptions() {
  const classes = new Set();
  const drivetrains = new Set();
  const manufacturers = new Set();
  const countries = new Set();
  const regions = new Set();
  const decades = new Set();
  let yearMin = Infinity;
  let yearMax = -Infinity;

  for (const car of cars) {
    if (car.class) classes.add(car.class);
    if (car.drivetrain) drivetrains.add(car.drivetrain);
    if (car.manufacturer) manufacturers.add(car.manufacturer);
    if (car.country) countries.add(car.country);
    if (car.region) regions.add(car.region);
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
    regions: [...regions].sort(),
    decades: [...decades].sort((a, b) => a - b),
    yearRange: [yearMin === Infinity ? null : yearMin, yearMax === -Infinity ? null : yearMax],
    totalCars: cars.length,
  };
}

function normalizeToken(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Resolves a chat command suffix (e.g. "japan", "honda", "s1", "rwd", "90s",
 * "asia") into a filters object, by matching it against known facet values.
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

  // Region/continent, e.g. "asia", "europe", "northamerica"
  const regionMatch = facets.regions.find((r) => normalizeToken(r) === norm);
  if (regionMatch) return { filters: { regions: [regionMatch] }, matchedType: "region", matchedValue: regionMatch };

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

module.exports = {
  loadCars,
  applyFilters,
  computeSpinResult,
  computeRandomSpin,
  getFacetOptions,
  resolveCommandToken,
  isFilterEmpty,
};
