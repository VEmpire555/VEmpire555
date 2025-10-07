const $ = (s) => document.querySelector(s);
const board = $("#board");
const list = $("#list");
const updated = $("#updated");
const modal = $("#modal");
const mtitle = $("#m_title");
const mbody = $("#m_body");
$("#close").addEventListener("click", ()=> modal.style.display="none");

// ---- Avgångslista (låst till PVH) ----
let pollHandle = null;

function fmt(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
}

async function refreshDepartures() {
  const lines = $("#lines").value || "";
  const to = $("#to").value || "";
  const url = `/api/vt/departures?stop_area_gid=${encodeURIComponent(window.PVH.gid)}&lines=${encodeURIComponent(lines)}&to_contains=${encodeURIComponent(to)}`;
  const res = await fetch(url);
  const data = await res.json();

  list.innerHTML = (data.departures||[]).map(d => {
    const badge = d.isRealtime ? "<small class='badge'>RT</small>" : "<small class='badge'>TT</small>";
    const ts = fmt(d.time);
    return `<li data-ref="${d.detailsReference||""}" data-line="${d.line}" data-dest="${d.destination}">
      <strong>${d.line}</strong> ${d.transportMode} → ${d.destination}
      &nbsp; <strong>${ts}</strong> ${badge}
    </li>`;
  }).join("") || "<li>Inga avgångar i närtid</li>";
  updated.textContent = `Uppdaterad: ${new Date().toLocaleTimeString()}`;
}

function start() {
  if (pollHandle) clearInterval(pollHandle);
  refreshDepartures();
  const sec = Number($("#interval").value || "60");
  pollHandle = setInterval(refreshDepartures, sec*1000);
}
$("#btn-run").addEventListener("click", start);

// Klick -> detaljerad resa
list.addEventListener("click", async (e) => {
  const li = e.target.closest("li[data-ref]");
  if (!li) return;
  const ref = li.getAttribute("data-ref");
  if (!ref) return;
  const url = `/api/vt/departure-details?stop_area_gid=${encodeURIComponent(window.PVH.gid)}&detailsReference=${encodeURIComponent(ref)}`;
  const res = await fetch(url);
  const data = await res.json();

  mtitle.textContent = `${li.getAttribute("data-line")} → ${li.getAttribute("data-dest")} (hållplatser)`;
  const rows = (data.calls||[]).map(c => `<li><strong>${fmt(c.time)}</strong> – ${c.stopName}${c.platform ? " (läge "+c.platform+")" : ""}</li>`).join("");
  const info = rows || "<li>Inga detaljer</li>";

  let poly = "";
  if (Array.isArray(data.coordinates) && data.coordinates.length) {
    poly = `<div class="muted" style="margin:.5rem 0">Linjesträckning: ${data.coordinates.length} koordinater</div>`;
  }
  mbody.innerHTML = `<ul>${info}</ul>${poly}`;
  modal.style.display = "flex";
});

// ---- Leaflet-karta med fordonspositioner ----
const map = L.map("map").setView([window.PVH.lat, window.PVH.lon], 14);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, attribution: "&copy; OpenStreetMap"
}).addTo(map);

let vehicleLayer = L.layerGroup().addTo(map);
let posHandle = null;

function getBoundsParams() {
  const b = map.getBounds();
  return {
    swLat: b.getSouthWest().lat, swLon: b.getSouthWest().lng,
    neLat: b.getNorthEast().lat, neLon: b.getNorthEast().lng
  };
}

async function refreshPositions() {
  const lines = $("#lines").value || "";
  const b = getBoundsParams();
  const qs = new URLSearchParams({...b, lines}).toString();
  const res = await fetch(`/api/vt/positions?${qs}`);
  const data = await res.json();

  vehicleLayer.clearLayers();
  (data.vehicles||[]).forEach(v => {
    if (typeof v.lat !== "number" || typeof v.lon !== "number") return;
    const m = L.circleMarker([v.lat, v.lon], {radius:6, color:"#0A6", fillColor:"#0A6", fillOpacity:.9});
    m.bindTooltip(`${v.line} → ${v.destination || ""}`);
    vehicleLayer.addLayer(m);
  });
}

map.on("moveend", refreshPositions);

function cardTemplate(cfg) {
  const id = `card_${Math.random().toString(36).slice(2)}`;
  const enc = (x) => encodeURIComponent(x || "");
  const qs = () => [
    `stop_area_gid=${enc(cfg.from_gid)}`,
    `lines=${enc(cfg.lines||"")}`,
    `to_contains=${enc(cfg.to_contains||"")}`,
  ].join("&");

  async function refresh() {
    const res = await fetch(`/api/vt/departures?${qs()}`);
    const data = await res.json();
    const rows = (data.departures||[]).map(d => {
      const badge = d.isRealtime ? "<small class='badge'>RT</small>" : "<small class='badge'>TT</small>";
      return `<li data-ref="${d.detailsReference||""}" data-line="${d.line}" data-dest="${d.destination}">
        <strong>${d.line}</strong> → ${d.destination} &nbsp;<strong>${fmt(d.time)}</strong> ${badge}
      </li>`;
    }).join("") || "<li>Inga avgångar</li>";
    const el = document.getElementById(id);
    if (!el) return;
    el.querySelector(".list").innerHTML = rows;
    el.querySelector(".updated").textContent = `Uppdaterad: ${new Date().toLocaleTimeString()}`;
  }

  const card = document.createElement("div");
  card.className = "card";
  card.id = id;
  card.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <h3 style="margin:0">${cfg.label || "Avgångar"}</h3>
      <button class="remove">Ta bort</button>
    </div>
    <div class="muted">${cfg.lines ? "Linjer: "+cfg.lines : "Alla linjer"} ${cfg.to_contains ? " · Dest: "+cfg.to_contains : ""}</div>
    <ul class="list" style="margin-top:.5rem"></ul>
    <div class="muted updated" style="margin-top:.5rem"></div>
  `;
  card.querySelector(".remove").addEventListener("click", () => {
    clearInterval(handle);
    card.remove();
  });
  card.addEventListener("click", async (e) => {
    const li = e.target.closest("li[data-ref]");
    if (!li) return;
    const ref = li.getAttribute("data-ref"); if (!ref) return;
    const url = `/api/vt/departure-details?stop_area_gid=${encodeURIComponent(cfg.from_gid)}&detailsReference=${encodeURIComponent(ref)}`;
    const res = await fetch(url); const data = await res.json();
    mtitle.textContent = `${li.getAttribute("data-line")} → ${li.getAttribute("data-dest")} (hållplatser)`;
    const rows = (data.calls||[]).map(c => `<li><strong>${fmt(c.time)}</strong> – ${c.stopName}${c.platform ? " (läge "+c.platform+")" : ""}</li>`).join("");
    mbody.innerHTML = `<ul>${rows || "<li>Inga detaljer</li>"}</ul>`;
    modal.style.display = "flex";
  });

  const sec = Number($("#interval").value || "60");
  const handle = setInterval(refresh, sec*1000);
  refresh();
  return card;
}

function addDefaultCards() {
  (window.DEFAULT_CARDS || []).forEach(cfg => board.appendChild(cardTemplate(cfg)));
}

addDefaultCards();
start();
refreshPositions();
posHandle = setInterval(refreshPositions, 30*1000);
