// Simple in-memory store for the filters currently active in the control panel.
// Restarting the server resets this to "no restrictions" — that's intentional
// for a lightweight local tool. Persist to disk yourself if you want it to
// survive restarts.

let activeFilters = {
  classes: [],
  drivetrains: [],
  manufacturers: [],
  countries: [],
  decades: [],
  yearMin: null,
  yearMax: null,
};

function getFilters() {
  return activeFilters;
}

function setFilters(newFilters) {
  activeFilters = { ...activeFilters, ...newFilters };
  return activeFilters;
}

module.exports = { getFilters, setFilters };
