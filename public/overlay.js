const card = document.getElementById("card");
const emptyEl = document.getElementById("empty");
const carNameEl = document.getElementById("carName");
const redeemedByEl = document.getElementById("redeemedBy");

const SPIN_DURATION_MS = 1200;
const DISPLAY_DURATION_MS = 8000;
let hideTimer = null;

function connect() {
  const wsUrl = `${location.origin.replace(/^http/, "ws")}/ws`;
  const ws = new WebSocket(wsUrl);

  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.type === "spin_result") handleSpinResult(data);
  };

  ws.onclose = () => setTimeout(connect, 3000);
}

function handleSpinResult({ label, poolSize, redeemedBy }) {
  clearTimeout(hideTimer);

  if (!label || poolSize === 0) {
    card.classList.add("hidden");
    emptyEl.classList.remove("hidden");
    hideTimer = setTimeout(() => emptyEl.classList.add("hidden"), 4000);
    return;
  }

  emptyEl.classList.add("hidden");
  redeemedByEl.textContent = redeemedBy ? `${redeemedBy} spun!` : "New spin!";
  card.classList.remove("hidden");
  card.classList.add("show", "spinning");

  // Quick flicker animation before settling on the real result.
  let ticks = 0;
  const flickerInterval = setInterval(() => {
    carNameEl.textContent = "?????????";
    ticks++;
    if (ticks > SPIN_DURATION_MS / 80) {
      clearInterval(flickerInterval);
      card.classList.remove("spinning");
      carNameEl.textContent = label;
    }
  }, 80);

  hideTimer = setTimeout(() => card.classList.remove("show"), DISPLAY_DURATION_MS);
}

connect();

// Loading/refreshing this page (e.g. re-adding the OBS Browser Source, or
// just opening it to check) reveals something random on its own — separate
// from spins triggered by chat/Channel Points/the control panel.
fetch("/api/random-spin")
  .then((r) => r.json())
  .then(handleSpinResult)
  .catch(() => {});
