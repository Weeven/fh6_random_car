const card = document.getElementById("card");
const emptyEl = document.getElementById("empty");
const carNameEl = document.getElementById("carName");
const redeemedByEl = document.getElementById("redeemedBy");
const wheelWrap = document.getElementById("wheelWrap");
const canvas = document.getElementById("wheel");
const ctx = canvas.getContext("2d");

const SLICE_COUNT = 20;
const SLICE_ANGLE = 360 / SLICE_COUNT;
const SPIN_MS = 4200;
const DISPLAY_DURATION_MS = 8000;

let hideTimer = null;
let currentRotation = 0;

// Pulls decoy slots from the server's same random-spin logic as the
// overlay's own auto-random reveal — so the wheel shows the same variety of
// possible results (manufacturer, decade, class, drivetrain, country, or
// combos), not just manufacturer names.
async function buildLabels(realLabel) {
  const decoys = await fetch(
    `/api/wheel-labels?count=${SLICE_COUNT - 1}&exclude=${encodeURIComponent(realLabel)}`
  )
    .then((r) => r.json())
    .then((d) => d.labels || [])
    .catch(() => []);

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
    const startAngle = -Math.PI / 2 + i * sliceRad; // slice 0 starts at 12 o'clock
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

// Rotates the wheel forward (never backward) to land the winning slice under
// the fixed pointer at the top, with a few extra full turns for suspense.
function spinTo(winningIndex) {
  const centerAngle = winningIndex * SLICE_ANGLE + SLICE_ANGLE / 2;
  const jitter = (Math.random() - 0.5) * (SLICE_ANGLE * 0.5);
  const desiredMod = (((360 - (centerAngle + jitter)) % 360) + 360) % 360;
  const currentMod = ((currentRotation % 360) + 360) % 360;

  let delta = desiredMod - currentMod;
  if (delta < 0) delta += 360;

  const extraTurns = 6 + Math.floor(Math.random() * 3); // 6-8 full spins
  currentRotation += extraTurns * 360 + delta;

  canvas.style.transition = `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.67, 0.15, 1)`;
  canvas.style.transform = `rotate(${currentRotation}deg)`;
}

function connect() {
  const wsUrl = `${location.origin.replace(/^http/, "ws")}/ws`;
  const ws = new WebSocket(wsUrl);

  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.type === "spin_result") handleSpinResult(data);
  };

  ws.onclose = () => setTimeout(connect, 3000);
}

async function handleSpinResult({ label, poolSize, redeemedBy }) {
  clearTimeout(hideTimer);

  if (!label || poolSize === 0) {
    card.classList.add("hidden");
    wheelWrap.classList.add("hidden");
    emptyEl.classList.remove("hidden");
    hideTimer = setTimeout(() => emptyEl.classList.add("hidden"), 4000);
    return;
  }

  emptyEl.classList.add("hidden");
  wheelWrap.classList.remove("hidden", "faded");
  card.classList.remove("hidden", "show");
  redeemedByEl.textContent = redeemedBy ? `${redeemedBy} spun!` : "";
  redeemedByEl.classList.toggle("hidden", !redeemedBy);

  const { labels, winningIndex } = await buildLabels(label);
  drawWheel(labels);
  spinTo(winningIndex);

  const onSpinEnd = (event) => {
    if (event.propertyName !== "transform") return;
    canvas.removeEventListener("transitionend", onSpinEnd);
    carNameEl.textContent = label;
    card.classList.add("show");
    hideTimer = setTimeout(() => {
      card.classList.remove("show");
      wheelWrap.classList.add("faded");
    }, DISPLAY_DURATION_MS);
  };
  canvas.addEventListener("transitionend", onSpinEnd);
}

async function init() {
  connect();

  // Loading/refreshing this page (e.g. re-adding the OBS Browser Source, or
  // just opening it to check) reveals something random on its own — separate
  // from spins triggered by chat/Channel Points/the control panel.
  fetch("/api/random-spin")
    .then((r) => r.json())
    .then(handleSpinResult)
    .catch(() => {});
}

init();
