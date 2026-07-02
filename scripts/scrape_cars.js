/**
 * scrape_cars.js
 * ----------------
 * Builds data/cars.json from kudosprime.com's FH6 car list (a well-maintained
 * community database with class, drivetrain, HP, weight etc. for every car).
 *
 * Run this on YOUR machine (not in any sandboxed CI environment) since it needs
 * outbound internet access:
 *
 *   npm install
 *   npm run scrape
 *
 * If kudosprime changes its page structure, this script may need small tweaks —
 * open the page in a browser, inspect the car row markup, and adjust the
 * cheerio selectors below accordingly. The script is intentionally defensive
 * (skips rows it can't parse instead of crashing) so partial site changes
 * don't nuke the whole run.
 */

const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const cheerio = require("cheerio");

// Passing range=2000 returns every car on a single page instead of the
// default 50-per-page pagination.
const SOURCE_URL = "https://www.kudosprime.com/fh6/carlist.php?range=2000&start=0";
const OUTPUT_PATH = path.join(__dirname, "..", "data", "cars.json");
const COUNTRY_MAP_PATH = path.join(__dirname, "..", "data", "manufacturer_countries.json");

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function scrape() {
  console.log(`Fetching ${SOURCE_URL} ...`);
  const res = await fetch(SOURCE_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (fh6-random-car-scraper)" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch source page: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  const countryMap = JSON.parse(fs.readFileSync(COUNTRY_MAP_PATH, "utf8"));

  // The page's own "Division" filter dropdown (Track Toys, Unlimited
  // Buggies, Rally Monsters, Hot Hatch, etc.) doubles as the id->name lookup
  // for each car's data-cty attribute — kudosprime doesn't print the name
  // inline on every car block, only the numeric id.
  const ACRONYM_FIXES = { Gt: "GT", "Utv's": "UTV's" };
  const divisionMap = {};
  $('select[name="cartype"] option').each((_, el) => {
    const value = $(el).attr("value");
    const text = $(el).text().trim();
    if (!value || !text) return;
    divisionMap[value] = text
      .toLowerCase()
      .split(" ")
      .map((w) => {
        const titled = w.charAt(0).toUpperCase() + w.slice(1);
        return ACRONYM_FIXES[titled] || titled;
      })
      .join(" ");
  });

  const cars = [];

  // Cars live inside #carlist as a flat sequence of siblings: a
  // <p class="groupby"><a>Manufacturer</a>...</p> header, followed by all of
  // that manufacturer's <div class="car ..." data-carid="...">...</div>
  // blocks, then the next groupby header, and so on. We walk the children in
  // order and track "current manufacturer" as we go, since the car blocks
  // themselves don't repeat the manufacturer name in a structured field.
  let currentManufacturer = null;

  $("#carlist")
    .children()
    .each((_, el) => {
      const node = $(el);

      if (node.hasClass("groupby")) {
        currentManufacturer = node.find("a").first().text().trim() || null;
        return;
      }

      if (!node.hasClass("car")) return;

      const carId = node.attr("data-carid");
      const fullName = node.find(".car_header .name").first().text().trim();
      if (!fullName || !currentManufacturer) return;

      const yearMatch = fullName.match(/^(\d{4})\s+(.*)$/);
      // A handful of franchise-crossover cars (e.g. the Halo Warthog, titled
      // "2554 AMG TRANSPORT DYNAMICS...") use an in-fiction year rather than
      // a real one — clamp to a plausible real-world range so they don't
      // pollute the year/decade filters with fake future decades.
      const parsedYear = yearMatch ? parseInt(yearMatch[1], 10) : null;
      const year = parsedYear && parsedYear >= 1900 && parsedYear <= new Date().getUTCFullYear() + 2 ? parsedYear : null;

      // First .car_tune block is the Stock tune — use it for class/drivetrain
      // so upgraded-tune variants elsewhere on the card don't get picked up.
      // A few special/DLC cars are unrated on kudosprime and show "unknown"
      // as the class — normalize that to null rather than a fake facet value.
      const stockTune = node.find(".car_tune").first();
      const rawClass = stockTune.find(".pi").first().attr("class")?.replace("pi", "").trim() || null;
      const classLetter = rawClass && rawClass !== "unknown" ? rawClass : null;
      const drivetrain = stockTune.find(".tr").first().text().trim() || null;

      const source = node.find(".car_source b").first().text().trim() || null;

      // Not every car has a division — plenty of everyday road cars sit
      // outside kudosprime's thematic groupings (Track Toys, Unlimited
      // Buggies, Rally Monsters, etc.), same as class being null for a
      // handful of unrated cars.
      const ctyId = node.find(".cty").first().attr("data-cty");
      const division = ctyId ? divisionMap[ctyId] || null : null;

      cars.push({
        id: carId ? `${carId}-${slugify(fullName)}` : slugify(`${year || "unk"}-${fullName}`),
        name: fullName,
        manufacturer: currentManufacturer,
        country: countryMap[currentManufacturer] || "Unknown",
        year,
        class: classLetter,
        drivetrain,
        division,
        rarity: null,
        source,
      });
    });

  if (cars.length === 0) {
    console.warn(
      "No cars parsed. kudosprime's page structure likely differs from the selectors " +
        "in this script — open the page in a browser, inspect the markup, and update " +
        "the cheerio selectors in scrape_cars.js."
    );
    console.warn("Leaving data/cars.json untouched so the app keeps working off the last known-good data.");
    return;
  }

  console.log(`Parsed ${cars.length} cars.`);
  const unknownCountries = [...new Set(cars.filter((c) => c.country === "Unknown").map((c) => c.manufacturer))];
  if (unknownCountries.length) {
    console.log(
      `${unknownCountries.length} manufacturer(s) missing from manufacturer_countries.json ` +
        `(country set to "Unknown"): ${unknownCountries.join(", ")}`
    );
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(cars, null, 2));
  console.log(`Wrote ${OUTPUT_PATH}`);
}

scrape().catch((err) => {
  console.error(err);
  process.exit(1);
});
