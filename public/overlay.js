const card = document.getElementById("card");
const emptyEl = document.getElementById("empty");
const carNameEl = document.getElementById("carName");
const carMetaEl = document.getElementById("carMeta");
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

function handleSpinResult({ car, poolSize, redeemedBy, matchedType, matchedValue }) {
  clearTimeout(hideTimer);

  if (!car || poolSize === 0) {
    card.classList.add("hidden");
    emptyEl.classList.remove("hidden");
    hideTimer = setTimeout(() => emptyEl.classList.add("hidden"), 4000);
    return;
  }

  emptyEl.classList.add("hidden");
  const filterNote = matchedType ? ` (${matchedType}: ${matchedValue})` : "";
  redeemedByEl.textContent = redeemedBy ? `${redeemedBy} spun for a new car!${filterNote}` : "New car!";
  card.classList.remove("hidden");
  card.classList.add("show", "spinning");
  carMetaEl.textContent = "";

  // Quick flicker animation before settling on the real result.
  let ticks = 0;
  const flickerInterval = setInterval(() => {
    carNameEl.textContent = "?????????";
    ticks++;
    if (ticks > SPIN_DURATION_MS / 80) {
      clearInterval(flickerInterval);
      card.classList.remove("spinning");
      carNameEl.textContent = car.name;
      carMetaEl.textContent = `${car.manufacturer} · ${car.country} · Class ${car.class} · ${car.drivetrain}${car.year ? ` · ${car.year}` : ""}`;
    }
  }, 80);

  hideTimer = setTimeout(() => card.classList.remove("show"), DISPLAY_DURATION_MS);
}

connect();
