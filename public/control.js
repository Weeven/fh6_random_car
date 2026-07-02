const groups = {
  classes: document.getElementById("classes"),
  drivetrains: document.getElementById("drivetrains"),
  countries: document.getElementById("countries"),
  manufacturers: document.getElementById("manufacturers"),
  decades: document.getElementById("decades"),
  divisions: document.getElementById("divisions"),
};

const poolCountEl = document.getElementById("poolCount");

async function init() {
  const [facets, activeFilters] = await Promise.all([
    fetch("/api/facets").then((r) => r.json()),
    fetch("/api/filters").then((r) => r.json()),
  ]);

  renderChips("classes", facets.classes, activeFilters.classes);
  renderChips("drivetrains", facets.drivetrains, activeFilters.drivetrains);
  renderChips("countries", facets.countries, activeFilters.countries);
  renderChips("manufacturers", facets.manufacturers, activeFilters.manufacturers);
  renderChips(
    "decades",
    facets.decades,
    activeFilters.decades,
    (decade) => `${decade}s`
  );
  renderChips("divisions", facets.divisions, activeFilters.divisions);

  refreshPoolCount();
}

function renderChips(groupKey, options, activeValues = [], labelFn = (v) => v) {
  const container = groups[groupKey];
  container.innerHTML = "";
  for (const value of options) {
    const chip = document.createElement("div");
    chip.className = "chip" + (activeValues.includes(value) ? " active" : "");
    chip.textContent = labelFn(value);
    chip.dataset.value = value;
    chip.addEventListener("click", () => chip.classList.toggle("active"));
    container.appendChild(chip);
  }
}

function getSelected(groupKey, isNumeric = false) {
  return [...groups[groupKey].querySelectorAll(".chip.active")].map((c) =>
    isNumeric ? parseInt(c.dataset.value, 10) : c.dataset.value
  );
}

async function saveFilters() {
  const filters = {
    classes: getSelected("classes"),
    drivetrains: getSelected("drivetrains"),
    countries: getSelected("countries"),
    manufacturers: getSelected("manufacturers"),
    decades: getSelected("decades", true),
    divisions: getSelected("divisions"),
    yearMin: null,
    yearMax: null,
  };
  await fetch("/api/filters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(filters),
  });
  refreshPoolCount();
}

async function refreshPoolCount() {
  const { count } = await fetch("/api/pool-count").then((r) => r.json());
  poolCountEl.textContent = `${count} car${count === 1 ? "" : "s"} currently eligible`;
}

async function spinNow() {
  // Always sync whatever's currently checked on screen first — otherwise a
  // spin can silently use stale filters from the last time Save was clicked.
  await saveFilters();
  await fetch("/api/spin", { method: "POST" });
}

document.getElementById("saveBtn").addEventListener("click", saveFilters);
document.getElementById("spinBtn").addEventListener("click", spinNow);

init();
