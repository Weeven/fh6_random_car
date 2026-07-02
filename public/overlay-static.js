// Fully static version of the wheel overlay — no server involved. Reads
// car data straight out of a bundled JSON file and does the same random-pick
// logic server/carPicker.js does, entirely client-side. The only way to
// trigger a new spin is reloading the page (e.g. a Stream Deck hotkey bound
// to OBS's "Refresh browser" on this source) — there's no live push from a
// control panel, since that needs a server to relay it.

const card = document.getElementById("card");
const carNameEl = document.getElementById("carName");
const redeemedByEl = document.getElementById("redeemedBy");
const wheelWrap = document.getElementById("wheelWrap");
const canvas = document.getElementById("wheel");
const ctx = canvas.getContext("2d");

const SLICE_COUNT = 20;
const SLICE_ANGLE = 360 / SLICE_COUNT;
const SPIN_MS = 4200;
const DISPLAY_DURATION_MS = 8000;

let currentRotation = 0;
let cars = [];

// ---- Ported from server/carPicker.js (random-pick logic only — no
// manual filters, no Twitch, nothing that needs a server) ----

const FILTER_KEYS = ["manufacturers", "divisions", "decades", "classes", "drivetrains", "countries"];
const MIN_POOL_SIZE = 6;

function applyFilters(filters = {}) {
  return cars.filter((c) => {
    if (filters.classes?.length && !filters.classes.includes(c.class)) return false;
    if (filters.drivetrains?.length && !filters.drivetrains.includes(c.drivetrain)) return false;
    if (filters.manufacturers?.length && !filters.manufacturers.includes(c.manufacturer)) return false;
    if (filters.countries?.length && !filters.countries.includes(c.country)) return false;
    if (filters.divisions?.length && !filters.divisions.includes(c.division)) return false;
    if (filters.decades?.length) {
      if (!c.year) return false;
      if (!filters.decades.includes(Math.floor(c.year / 10) * 10)) return false;
    }
    return true;
  });
}

function isFilterEmpty(filters = {}) {
  return (
    !filters.classes?.length &&
    !filters.drivetrains?.length &&
    !filters.manufacturers?.length &&
    !filters.countries?.length &&
    !filters.decades?.length &&
    !filters.divisions?.length
  );
}

function activeFilterKeys(filters) {
  return FILTER_KEYS.filter((key) => filters[key]?.length);
}

function labelForFilters(filters) {
  const parts = [];
  if (filters.countries?.length) parts.push(filters.countries.join("/"));
  if (filters.manufacturers?.length) parts.push(filters.manufacturers.join("/"));
  if (filters.divisions?.length) parts.push(filters.divisions.join("/"));
  if (filters.classes?.length) parts.push(`Class ${filters.classes.join("/")}`);
  if (filters.drivetrains?.length) parts.push(filters.drivetrains.join("/"));
  if (filters.decades?.length) parts.push(filters.decades.map((d) => `${d}s`).join("/"));
  return parts.join(" · ");
}

function weightedManufacturerWithMinCount(minCount) {
  const counts = new Map();
  for (const car of cars) {
    if (!car.manufacturer) continue;
    counts.set(car.manufacturer, (counts.get(car.manufacturer) || 0) + 1);
  }
  const eligible = cars.filter((c) => c.manufacturer && counts.get(c.manufacturer) >= minCount);
  const pool = eligible.length > 0 ? eligible : cars;
  return pool[Math.floor(Math.random() * pool.length)].manufacturer;
}

function broadenPool(filters) {
  let active = { ...filters };
  let pool = applyFilters(active);
  while (pool.length < MIN_POOL_SIZE) {
    const remaining = activeFilterKeys(active);
    if (remaining.length === 0) break;
    const keyToDrop = FILTER_KEYS.find((key) => active[key]?.length);
    active = { ...active, [keyToDrop]: [] };
    pool = applyFilters(active);
  }
  return { active, pool };
}

// Weighted by sqrt(manufacturer car count) rather than raw count — keeps big
// manufacturers/countries somewhat favored without them dominating almost
// every refresh, and gives niche ones a real (if smaller) shot.
function sqrtWeightedSourceCar() {
  const byManufacturer = new Map();
  for (const car of cars) {
    if (!car.manufacturer) continue;
    if (!byManufacturer.has(car.manufacturer)) byManufacturer.set(car.manufacturer, []);
    byManufacturer.get(car.manufacturer).push(car);
  }

  const weighted = [...byManufacturer.entries()].map(([manufacturer, list]) => ({
    list,
    weight: Math.sqrt(list.length),
  }));
  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);

  let roll = Math.random() * totalWeight;
  for (const { list, weight } of weighted) {
    roll -= weight;
    if (roll <= 0) return list[Math.floor(Math.random() * list.length)];
  }
  return weighted[weighted.length - 1].list[0];
}

const JACKPOT_CHANCE = 0.1; // 1-in-10 auto-reveals show one exact car instead of a category

// Best-effort cleanup for a jackpot exact-car reveal — strips the year, a
// duplicated manufacturer prefix, race-livery numbers, parenthetical
// chassis/edition codes, and a short list of cosmetic edition words. Not
// perfect on every entry (kudosprime's names are inconsistent), but turns
// e.g. "2012 Nissan GT-R BLACK EDITION (R35)" into "Nissan GT-R".
function cleanCarName(car) {
  let s = car.name.replace(/^\d{4}\s+/, "");

  if (car.manufacturer) {
    const escaped = car.manufacturer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`^${escaped}\\s+`, "i"), "");
  }

  s = s.replace(/^#\d+\s+/, "");
  s = s.replace(/\([^)]*\)/g, "");

  const noiseWords = ["Forza Edition", "40th Anniversary", "Anniversary", "Black Edition"];
  for (const word of noiseWords) {
    s = s.replace(new RegExp(`\\b${word}\\b`, "gi"), "");
  }

  return `${car.manufacturer} ${s}`.replace(/\s+/g, " ").trim();
}

function computeRandomSpin() {
  if (Math.random() < JACKPOT_CHANCE) {
    const jackpotCar = sqrtWeightedSourceCar();
    return { label: cleanCarName(jackpotCar), poolSize: 1 };
  }

  const sourceCar = sqrtWeightedSourceCar();
  const sourceDecade = sourceCar.year ? Math.floor(sourceCar.year / 10) * 10 : null;

  const dimensionValues = {
    manufacturers: sourceCar.manufacturer,
    decades: sourceDecade,
    classes: sourceCar.class,
    drivetrains: sourceCar.drivetrain,
    countries: sourceCar.country,
    divisions: sourceCar.division,
  };

  const availableKeys = FILTER_KEYS.filter((key) => dimensionValues[key] != null);
  for (let i = availableKeys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [availableKeys[i], availableKeys[j]] = [availableKeys[j], availableKeys[i]];
  }

  const dimensionCount = Math.floor(Math.random() * 3); // 0, 1, or 2 dimensions
  const filters = {};
  for (const key of availableKeys) {
    if (activeFilterKeys(filters).length >= dimensionCount) break;
    if (key === "countries" && filters.manufacturers?.length) continue;
    if (key === "manufacturers" && filters.countries?.length) continue;
    filters[key] = [dimensionValues[key]];
  }

  const { active, pool } = broadenPool(filters);
  if (isFilterEmpty(active)) {
    const manufacturer = weightedManufacturerWithMinCount(MIN_POOL_SIZE);
    return { label: manufacturer, poolSize: cars.length };
  }

  return { label: labelForFilters(active), poolSize: pool.length };
}

function sampleRandomLabels(count, excludeLabel) {
  const seen = new Set();
  if (excludeLabel) seen.add(excludeLabel);
  const labels = [];
  const maxAttempts = count * 50 + 200;
  for (let attempts = 0; labels.length < count && attempts < maxAttempts; attempts++) {
    const { label } = computeRandomSpin();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

// ---- Wheel drawing / spin (identical to overlay-wheel.js) ----

function buildLabels(realLabel) {
  const decoys = sampleRandomLabels(SLICE_COUNT - 1, realLabel);
  const winningIndex = Math.floor(Math.random() * SLICE_COUNT);
  const labels = [...decoys];
  labels.splice(winningIndex, 0, realLabel);
  while (labels.length < SLICE_COUNT) labels.push("");
  return { labels, winningIndex };
}

function truncateForSlice(text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1 && ctx.measureText(`${truncated}…`).width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
}

function drawWheel(labels) {
  const size = canvas.width;
  const radius = size / 2;
  const sliceRad = (SLICE_ANGLE * Math.PI) / 180;

  ctx.clearRect(0, 0, size, size);

  for (let i = 0; i < labels.length; i++) {
    const startAngle = -Math.PI / 2 + i * sliceRad;
    const endAngle = startAngle + sliceRad;

    ctx.beginPath();
    ctx.moveTo(radius, radius);
    ctx.arc(radius, radius, radius - 4, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = i % 2 === 0 ? "#e21a1a" : "#151515";
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.save();
    ctx.translate(radius, radius);
    ctx.rotate(startAngle + sliceRad / 2);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 13px 'Segoe UI', Arial, sans-serif";
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 3;
    const text = truncateForSlice(labels[i] || "", radius - 60);
    ctx.fillText(text, radius - 22, 0);
    ctx.restore();
  }
}

function spinTo(winningIndex) {
  const centerAngle = winningIndex * SLICE_ANGLE + SLICE_ANGLE / 2;
  const jitter = (Math.random() - 0.5) * (SLICE_ANGLE * 0.5);
  const desiredMod = (((360 - (centerAngle + jitter)) % 360) + 360) % 360;
  const currentMod = ((currentRotation % 360) + 360) % 360;

  let delta = desiredMod - currentMod;
  if (delta < 0) delta += 360;

  const extraTurns = 6 + Math.floor(Math.random() * 3);
  currentRotation += extraTurns * 360 + delta;

  canvas.style.transition = `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.67, 0.15, 1)`;
  canvas.style.transform = `rotate(${currentRotation}deg)`;
}

function spin() {
  const { label } = computeRandomSpin();

  wheelWrap.classList.remove("faded");
  card.classList.remove("hidden", "show");
  redeemedByEl.textContent = "";
  redeemedByEl.classList.add("hidden");

  const { labels, winningIndex } = buildLabels(label);
  drawWheel(labels);
  spinTo(winningIndex);

  const onSpinEnd = (event) => {
    if (event.propertyName !== "transform") return;
    canvas.removeEventListener("transitionend", onSpinEnd);
    carNameEl.textContent = label;
    card.classList.add("show");
    setTimeout(() => {
      card.classList.remove("show");
      wheelWrap.classList.add("faded");
    }, DISPLAY_DURATION_MS);
  };
  canvas.addEventListener("transitionend", onSpinEnd);
}

async function init() {
  cars = await fetch("data/cars.json").then((r) => r.json());
  spin();
}

init();
