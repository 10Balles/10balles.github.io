"use strict";
/* Dix Balles — version publique (site statique + base Supabase) */
const CFG = window.DIXBALLES || {};
const INSTAGRAM = CFG.instagram || "@10balle.s";
const INSTAGRAM_URL = CFG.instagramUrl || "https://www.instagram.com/" + INSTAGRAM.replace(/^@/, "") + "/";
const GEOCODER = "https://data.geopf.fr/geocodage/search";

/* ---------- Données de base ---------- */
const CATS = {
  food:    { label: "Manger",             color: "--c-food" },
  culture: { label: "Musée & expo",       color: "--c-culture" },
  vue:     { label: "Vue & rooftop",      color: "--c-vue" },
  balade:  { label: "Balade & plein air", color: "--c-balade" },
  soiree:  { label: "Soirée & concert",   color: "--c-soiree" },
  cine:    { label: "Ciné & spectacle",   color: "--c-cine" },
  autre:   { label: "Autre",              color: "--c-autre" }
};
const SUBS = { resto: "Resto & cantine", snack: "Snack & street food", sucre: "Sucré" };
const vegSelect = (id, val) => h("select", { id },
  h("option", { value: "", selected: !val }, "Pas d'option végé connue"),
  h("option", { value: "option", selected: val === "option" }, "Au moins un plat végé à ce prix"),
  h("option", { value: "full", selected: val === "full" }, "100 % végétarien"));
const catLabel = p => (CATS[p.cat] || CATS.autre).label + (p.cat === "food" && SUBS[p.sub] ? " · " + SUBS[p.sub] : "");

/* ---------- Utilitaires ---------- */
const $ = id => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}
function s(tag, attrs = {}) { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; }
const norm = v => String(v ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const arrLabel = n => n === 1 ? "1er" : n + "e";
const fmtPrice = p => p === 0 ? "Gratuit" : p.toLocaleString("fr-FR", Number.isInteger(p) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const catColor = c => `var(${(CATS[c] || CATS.autre).color})`;
const catHex = c => getComputedStyle(document.documentElement).getPropertyValue((CATS[c] || CATS.autre).color).trim() || "#5D6778";
const isUrl = u => typeof u === "string" && /^https?:\/\/[^\s]+$/i.test(u);
const hasGeo = p => typeof p.lat === "number" && typeof p.lng === "number";
const mapsLink = p => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent([p.name, p.address, p.city].filter(Boolean).join(", "));
const ficheUrl = p => isUrl(p.ficheLink) ? p.ficheLink : null;
const routeLink = p => p.placeId
  ? "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(p.name + ", " + p.address) + "&destination_place_id=" + encodeURIComponent(p.placeId)
  : hasGeo(p) ? "https://www.google.com/maps/dir/?api=1&destination=" + p.lat + "," + p.lng : mapsLink(p);
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let toastTimer;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4200); }
function cityKey(c) { return norm(c); }
function prettyCity(c) { const t = String(c || "").trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ""; }
const fmtDate = t => new Date(t).toLocaleDateString("fr-FR");
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
};
/* Identifiant aléatoire de l'appareil : sert à limiter les abus et à retenir tes notes. Pas de nom, pas d'e-mail. */
const DEVICE = (() => {
  let d = store.get("dixballes.device", null);
  if (typeof d !== "string" || d.length < 8) {
    d = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, "").slice(0, 32);
    store.set("dixballes.device", d);
  }
  return d;
})();

/* ---------- État ---------- */
const S = {
  sb: null, live: false, isTeam: false, email: null,
  plans: [], ratings: {}, reports: [],
  myRatings: store.get("dixballes.ratings", {}), myReports: store.get("dixballes.reports", {}),
  f: { q: "", city: "", arr: "", budget: "all", cat: "all", sub: "all", veg: false },
  selected: null, sheet: null, lastRoll: null, fitKey: null,
  pick: { key: null, ids: [] }, showAll: false, pinned: null
};
const allPlaces = () => S.plans.filter(p => p.status === "published");
const byId = id => allPlaces().find(p => p.id === id) || (S.isTeam ? S.plans.find(p => p.id === id) : undefined);
const byIdAny = id => S.plans.find(p => p.id === id);

function fromRow(r) {
  const num = v => v === null || v === undefined || v === "" ? null : Number(v);
  const time = v => v ? Date.parse(v) || null : null;
  return {
    id: String(r.id), name: r.name || "", cat: CATS[r.cat] ? r.cat : "autre", sub: SUBS[r.sub] ? r.sub : null,
    veg: r.veg === "option" || r.veg === "full" ? r.veg : null, vegNote: r.veg_note || "",
    price: Number(r.price), deal: r.deal || "", cond: r.cond || "", address: r.address || "",
    city: r.city || "", postcode: r.postcode || "", arr: Number.isInteger(r.arr) ? r.arr : null,
    lat: num(r.lat), lng: num(r.lng), placeId: r.place_id || null, ficheLink: r.fiche_link || null,
    proof: r.proof_link || null, photoPath: r.proof_photo || null,
    src: r.src_label ? { label: r.src_label, url: r.src_url, date: r.src_date || "" } : null,
    recheck: !!r.recheck, status: r.status || "published", origin: r.origin || "seed", verified: !!r.verified,
    checkedAt: time(r.checked_at), createdAt: time(r.created_at), editedAt: time(r.edited_at), hiddenAt: time(r.hidden_at)
  };
}

function matches(p) {
  const f = S.f;
  if (f.city && cityKey(p.city) !== f.city) return false;
  if (f.arr && String(p.arr) !== f.arr) return false;
  if (f.budget === "free" && p.price > 0) return false;
  if (f.budget === "5" && p.price > 5) return false;
  if (f.cat !== "all" && p.cat !== f.cat) return false;
  if (f.cat === "food" && f.sub !== "all" && p.sub !== f.sub) return false;
  if (f.cat === "food" && f.veg && !p.veg) return false;
  if (f.q) {
    const hay = norm([p.name, p.deal, p.address, p.city, p.cond, catLabel(p), p.arr ? arrLabel(p.arr) : ""].join(" "));
    if (!norm(f.q).split(/\s+/).every(w => hay.includes(w))) return false;
  }
  return true;
}
const filtered = () => allPlaces().filter(matches).sort((a, b) => a.price - b.price || a.name.localeCompare(b.name, "fr"));
function rating(id) { const r = S.ratings[id]; return r ? r : { avg: 0, n: 0 }; }
const myVote = id => S.myRatings[id] || 0;
function statusOf(p) {
  if (p.verified) return { kind: "ok" };
  if (p.origin === "seed") return { kind: p.recheck ? "recheck" : "seed" };
  return { kind: p.status === "pending" ? "pending" : "community" };
}

/* ---------- Connexion à la base ---------- */
function initSupabase() {
  if (!CFG.supabaseUrl || !CFG.supabaseKey || !window.supabase) return null;
  try { return window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, detectSessionInUrl: true, flowType: "implicit" } }); }
  catch (_) { return null; }
}
async function fetchAllPlans() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await S.sb.from("plans").select("*").order("id").range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}
async function loadData() {
  let rows = null;
  if (S.sb) {
    try { rows = await fetchAllPlans(); S.live = true; } catch (_) { S.live = false; }
  }
  if (!rows) {
    try { const r = await fetch("data/plans.json", { cache: "no-cache" }); rows = (await r.json()).filter(x => x.status === "published"); }
    catch (_) { rows = []; }
  }
  S.plans = rows.map(fromRow).filter(p => p.name && p.price >= 0 && p.price <= 10);
  if (S.sb && S.live) {
    try {
      const { data } = await S.sb.rpc("plan_ratings");
      S.ratings = Object.fromEntries((data || []).map(r => [r.plan_id, { avg: Number(r.avg), n: Number(r.n) }]));
    } catch (_) {}
    if (S.isTeam) {
      try {
        const { data } = await S.sb.from("reports").select("*").eq("resolved", false).order("created_at", { ascending: false });
        S.reports = data || [];
      } catch (_) { S.reports = []; }
    }
  }
  $("modeNote").textContent = S.live ? "" : (S.sb ? "Connexion à la base impossible pour le moment : affichage de la base de départ." : "");
  renderAll();
}
async function checkTeam() {
  if (!S.sb) return;
  let session = null;
  try { ({ data: { session } } = await S.sb.auth.getSession()); } catch (_) {}
  const was = S.isTeam;
  S.email = session && session.user ? session.user.email : null;
  S.isTeam = false;
  if (session) { try { const { data } = await S.sb.rpc("is_team"); S.isTeam = data === true; } catch (_) {} }
  $("teamBtn").hidden = !S.isTeam;
  $("teamLogin").textContent = S.email ? (S.isTeam ? "Espace équipe" : "Se déconnecter") : "Accès équipe";
  if (was !== S.isTeam) await loadData();
}

/* ---------- Carte (Leaflet + OpenStreetMap) ---------- */
const OSM = { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attr: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' };
const FRANCE = [[42.2, -5.2], [51.2, 8.4]];
/* Fond de carte : CARTO Positron / Dark Matter si une clé CARTO est dans config.js, sinon OpenStreetMap en gris */
const CARTO_ATTR = OSM.attr + ' &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';
const darkMQ = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
const isDark = () => { const t = document.documentElement.dataset.theme; return t === "dark" || (t !== "light" && !!(darkMQ && darkMQ.matches)); };
const osmLayer = () => L.tileLayer(OSM.url, { maxZoom: 19, attribution: OSM.attr, className: "map-tiles" });
function addBaseLayer(m) {
  const key = String(CFG.cartoKey || "").trim();
  if (!key) return osmLayer().addTo(m);
  const url = () => `https://{s}.basemaps.cartocdn.com/${isDark() ? "dark_all" : "light_all"}/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(key)}`;
  const layer = L.tileLayer(url(), { maxZoom: 20, subdomains: "abcd", attribution: CARTO_ATTR, className: "carto-tiles" }).addTo(m);
  if (darkMQ && darkMQ.addEventListener) darkMQ.addEventListener("change", () => layer.setUrl(url()));
  // Clé refusée ou service indisponible : on repasse sur OpenStreetMap
  let errors = 0, loaded = false;
  layer.on("tileload", () => { loaded = true; });
  layer.on("tileerror", () => { if (!loaded && ++errors === 4) { m.removeLayer(layer); osmLayer().addTo(m); } });
  return layer;
}
const dotIcon = (p, sel) => L.divIcon({ className: "", html: `<span class="dot-pin${sel ? " sel" : ""}" style="background:${catHex(p.cat)}"></span>`, iconSize: sel ? [24, 24] : [12, 12], iconAnchor: sel ? [12, 12] : [6, 6] });
function makeMap() {
  if (!window.L) return { setPins() {}, focus() {}, fit() {}, refresh() {} };
  const m = L.map("map", { zoomSnap: 0.5, scrollWheelZoom: true, worldCopyJump: false }).fitBounds(FRANCE);
  addBaseLayer(m);
  const group = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 42, spiderfyOnMaxZoom: true });
  m.addLayer(group);
  let markers = new Map(), sel = null;
  return {
    setPins(list, selected) {
      group.clearLayers(); markers = new Map(); sel = selected;
      const layers = [];
      for (const p of list) {
        if (!hasGeo(p)) continue;
        const mk = L.marker([p.lat, p.lng], { icon: dotIcon(p, p.id === selected), title: p.name + " · " + fmtPrice(p.price), keyboard: true, zIndexOffset: p.id === selected ? 1000 : 0 });
        mk.on("click", () => openDetail(p.id));
        markers.set(p.id, mk); layers.push(mk);
      }
      group.addLayers(layers);
    },
    focus(id) {
      const mk = markers.get(id); if (!mk) return;
      group.zoomToShowLayer(mk, () => { if (m.getZoom() < 14) m.setView(mk.getLatLng(), 14, { animate: !reduced() }); });
    },
    fit(list) {
      const pts = list.filter(hasGeo).map(p => [p.lat, p.lng]);
      if (!pts.length) { m.fitBounds(FRANCE); return; }
      if (pts.length === 1) { m.setView(pts[0], 14); return; }
      m.fitBounds(L.latLngBounds(pts).pad(0.08), { maxZoom: 14, animate: !reduced() });
    },
    refresh() { m.invalidateSize(); }
  };
}
function makePickMap(el, start, onPick) {
  if (!window.L) return { set() {}, refresh() {} };
  const m = L.map(el, { zoomSnap: 0.5, scrollWheelZoom: false });
  addBaseLayer(m);
  let mk = null;
  const set = (lat, lng, zoom) => {
    if (lat == null) { if (mk) { m.removeLayer(mk); mk = null; } m.fitBounds(FRANCE); return; }
    if (!mk) { mk = L.marker([lat, lng], { draggable: true, icon: L.divIcon({ className: "", html: '<span class="dot-pin sel" style="background:#FFCB1F"></span>', iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(m); mk.on("dragend", () => { const ll = mk.getLatLng(); onPick(+ll.lat.toFixed(6), +ll.lng.toFixed(6)); }); }
    else mk.setLatLng([lat, lng]);
    m.setView([lat, lng], zoom || Math.max(m.getZoom() || 0, 16));
  };
  m.on("click", e => { set(e.latlng.lat, e.latlng.lng, m.getZoom()); onPick(+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)); });
  if (start) set(start[0], start[1], 16); else m.fitBounds(FRANCE);
  return { set, refresh() { setTimeout(() => m.invalidateSize(), 60); } };
}
/* Recherche d'adresse : Géoplateforme de l'IGN (données ouvertes, Base Adresse Nationale) */
async function geocode(q, limit = 5) {
  const url = GEOCODER + "?q=" + encodeURIComponent(q) + "&limit=" + limit;
  const r = await fetch(url);
  if (!r.ok) throw new Error("geocode " + r.status);
  const j = await r.json();
  return (j.features || []).map(f => {
    const pr = f.properties || {}, [lng, lat] = (f.geometry && f.geometry.coordinates) || [];
    const code = String(pr.citycode || "");
    const arr = /^751(0[1-9]|1[0-9]|20)$/.test(code) ? Number(code.slice(3)) : null;
    const city = arr ? "Paris" : /^6938[1-9]$/.test(code) ? "Lyon" : /^132(0[1-9]|1[0-6])$/.test(code) ? "Marseille" : (pr.city || "");
    return { label: pr.label || "", street: pr.name || "", postcode: pr.postcode || "", city, arr, lat, lng, score: pr.score || 0, type: pr.type || "" };
  }).filter(x => typeof x.lat === "number");
}

/* ---------- Rendu ---------- */
const map = makeMap();
const BUDGETS = [["all", "Tout ≤ 10 €"], ["5", "≤ 5 €"], ["free", "Gratuit"]];
function renderChips() {
  $("budgetChips").replaceChildren(...BUDGETS.map(([k, label]) => h("button", { type: "button", class: "chip", "aria-pressed": String(S.f.budget === k), onclick: () => { S.f.budget = k; renderAll(); } }, label)));
  const cats = [["all", "Tout", null]].concat(Object.entries(CATS).map(([k, c]) => [k, c.label, k]));
  $("catChips").replaceChildren(...cats.map(([k, label, c]) => h("button", { type: "button", class: "chip", "aria-pressed": String(S.f.cat === k), onclick: () => { S.f.cat = k; S.f.sub = "all"; renderAll(); } },
    c ? h("span", { class: "dot", style: `background:${catColor(c)}` }) : null, label)));
  $("subRow").hidden = S.f.cat !== "food";
  const subs = [["all", "Tout"]].concat(Object.entries(SUBS).filter(([k]) => allPlaces().some(p => p.cat === "food" && p.sub === k)));
  $("subChips").replaceChildren(...subs.map(([k, label]) => h("button", { type: "button", class: "chip", "aria-pressed": String(S.f.sub === k), onclick: () => { S.f.sub = k; renderAll(); } }, label)));
  $("subChips").append(h("button", { type: "button", class: "chip", "aria-pressed": String(S.f.veg), onclick: () => { S.f.veg = !S.f.veg; renderAll(); } },
    h("span", { class: "dot", style: "background:var(--c-balade)" }), "Végé"));
}
function cityCounts() {
  const m = new Map();
  for (const p of allPlaces()) { const k = cityKey(p.city); if (!k) continue; const c = m.get(k) || { name: prettyCity(p.city), n: 0 }; c.n++; m.set(k, c); }
  return m;
}
function renderSelects() {
  const cities = cityCounts();
  const citySel = $("city");
  citySel.replaceChildren(h("option", { value: "" }, "Toute la France (" + allPlaces().length + ")"),
    ...[...cities.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, "fr")).map(([k, v]) => h("option", { value: k }, `${v.name} (${v.n})`)));
  if (S.f.city && !cities.has(S.f.city)) S.f.city = "";
  citySel.value = S.f.city;
  const arrSel = $("arr");
  const isParis = S.f.city === "paris";
  arrSel.hidden = !isParis;
  if (!isParis) S.f.arr = "";
  if (!arrSel.options.length) arrSel.append(h("option", { value: "" }, "Tous les arrondissements"), ...Array.from({ length: 20 }, (_, i) => h("option", { value: String(i + 1) }, arrLabel(i + 1) + " arrondissement")));
  arrSel.value = S.f.arr;
}
function renderCityNote() {
  const el = $("cityNote");
  const addBtn = label => h("button", { type: "button", class: "btn btn-small", onclick: openAdd }, label);
  if (S.f.city === "paris") { el.replaceChildren(); return; }
  if (!S.f.city) {
    const all = allPlaces(), paris = all.filter(p => cityKey(p.city) === "paris").length;
    el.replaceChildren(h("div", { class: "callout" },
      h("strong", null, "C'est un début !"),
      h("p", null, `${all.length} bons plans, dont ${paris} à Paris parce que c'est là qu'on vit. Pour le reste de la France, on compte sur toi : ajoute les bons plans de ta ville.`),
      addBtn("Ajouter un plan de ma ville")));
    return;
  }
  const name = (cityCounts().get(S.f.city) || {}).name || prettyCity(S.f.city);
  const n = allPlaces().filter(p => cityKey(p.city) === S.f.city).length;
  el.replaceChildren(h("div", { class: "callout" },
    h("strong", null, n < 20 ? `${name} : ce n'est qu'un début` : name),
    h("p", null, n < 20 ? `On n'a que ${n} plan${n > 1 ? "s" : ""} ici pour l'instant. Tu connais un bon plan à ${name} ? Ajoute-le, l'équipe le vérifie et il apparaît sur la carte.` : `Tu connais un bon plan à ${name} qui manque ? Ajoute-le.`),
    addBtn("Ajouter un plan à " + name)));
}
function priceEl(p) { return h("span", { class: "price" + (p.price === 0 ? " free" : ""), "aria-label": p.price === 0 ? "Gratuit" : "Prix " + fmtPrice(p.price) }, fmtPrice(p.price)); }
function statusPill(p) {
  const st = statusOf(p);
  if (st.kind === "ok") return h("span", { class: "pill ok" }, "Vérifié");
  if (st.kind === "pending") return h("span", { class: "pill warn" }, "En attente");
  if (st.kind === "recheck") return h("span", { class: "pill warn" }, "À reconfirmer");
  return null;
}
const whereLabel = p => p.arr && cityKey(p.city) === "paris" ? arrLabel(p.arr) : prettyCity(p.city);
/* Liste courte : 5 idées au hasard, liste complète sur demande */
const PICK_N = 5, SHOW_ALL_UNDER = 8;
function shufflePick(list) {
  const a = list.map(p => p.id);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, PICK_N);
}
function planRow(p) {
  const r = rating(p.id);
  return h("button", { type: "button", class: "row" + (p.id === S.selected ? " sel" : ""), onclick: () => openDetail(p.id) },
    h("span", { class: "row-body" },
      h("span", { class: "row-meta" },
        h("span", { class: "dot", style: `background:${catColor(p.cat)}` }),
        catLabel(p) + " · " + whereLabel(p),
        r.n ? h("span", { class: "stars-mini" }, "· ★ " + r.avg.toFixed(1).replace(".", ",") + " (" + r.n + ")") : null,
        statusPill(p),
        p.cat === "food" && p.veg ? h("span", { class: "pill veg" }, p.veg === "full" ? "100 % végé" : "Option végé") : null),
      h("span", { class: "row-name" }, p.name),
      h("span", { class: "row-deal" }, p.deal)),
    priceEl(p));
}
function renderList(list) {
  const el = $("list"), sub = $("listSub"), more = $("listMore");
  const key = JSON.stringify(S.f);
  if (S.pick.key !== key) { S.pick = { key, ids: shufflePick(list) }; S.showAll = false; S.pinned = null; }
  const inList = new Set(list.map(p => p.id));
  if (S.pick.ids.filter(id => inList.has(id)).length < Math.min(PICK_N, list.length)) S.pick.ids = shufflePick(list);
  if (!list.length) {
    sub.hidden = true; more.replaceChildren();
    el.replaceChildren(h("div", { class: "empty" },
      h("strong", { text: "Aucun plan avec ces filtres." }),
      h("span", { text: "Élargis le budget ou la catégorie, ou ajoute le premier plan de ce coin." }),
      h("div", { class: "links", style: "justify-content:center" },
        h("button", { type: "button", class: "btn btn-small", onclick: () => { S.f = { q: "", city: S.f.city, arr: "", budget: "all", cat: "all", sub: "all", veg: false }; $("q").value = ""; renderAll(); } }, "Réinitialiser les filtres"),
        h("button", { type: "button", class: "btn btn-small btn-ink", onclick: openAdd }, "Ajouter un plan"))));
    return;
  }
  const forced = S.f.q.trim() !== "" || list.length <= SHOW_ALL_UNDER;
  let rows;
  if (forced || S.showAll) rows = list;
  else {
    rows = S.pick.ids.filter(id => inList.has(id)).map(id => list.find(p => p.id === id));
    if (S.pinned && inList.has(S.pinned) && !S.pick.ids.includes(S.pinned)) rows.unshift(list.find(p => p.id === S.pinned));
  }
  sub.hidden = forced;
  if (!forced) {
    sub.replaceChildren(...[
      h("span", { text: S.showAll ? `Tous les plans (${list.length})` : `${PICK_N} idées au hasard parmi ${list.length}` }),
      S.showAll ? null : h("button", { type: "button", class: "btn btn-small", onclick: () => { S.pick.ids = shufflePick(list); S.pinned = null; renderList(list); } }, "Autres idées ↻")
    ].filter(Boolean));
    more.replaceChildren(h("button", { type: "button", class: "btn list-more", "aria-expanded": String(S.showAll), "aria-controls": "list",
      onclick: () => {
        S.showAll = !S.showAll; renderList(list);
        if (!S.showAll) document.querySelector(".list-col").scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" });
      } }, S.showAll ? "Réduire ▴" : `Voir les ${list.length} plans ▾`));
  } else more.replaceChildren();
  el.replaceChildren(...rows.map(planRow));
}
function renderAll() {
  renderChips(); renderSelects(); renderCityNote();
  const list = filtered();
  const all = allPlaces();
  const free = all.filter(p => p.price === 0).length;
  const cities = cityCounts().size;
  $("heroStats").textContent = `${all.length} bons plans · ${free} gratuits · ${cities} ${cities > 1 ? "villes" : "ville"}`;
  $("listCount").textContent = list.length + (list.length > 1 ? " résultats" : " résultat");
  const onMap = list.filter(hasGeo).length;
  $("mapCount").textContent = onMap + (onMap > 1 ? " lieux sur la carte" : " lieu sur la carte");
  map.setPins(list, S.selected);
  const fk = S.f.city + "|" + S.f.arr;
  if (S.fitKey !== fk && all.length) { S.fitKey = fk; map.fit(S.f.city ? list : all); }
  renderList(list);
  if (S.sheet === "detail" && S.selected) renderDetail(S.selected);
  if (S.sheet === "team") renderTeam();
  if (S.isTeam) {
    const todo = S.reports.length + S.plans.filter(p => p.status === "pending").length;
    $("teamBtn").textContent = todo ? `Équipe (${todo})` : "Équipe";
  }
}

/* ---------- Filtres ---------- */
let qTimer;
$("q").addEventListener("input", e => { clearTimeout(qTimer); qTimer = setTimeout(() => { S.f.q = e.target.value; renderAll(); }, 120); });
$("city").addEventListener("change", e => { S.f.city = e.target.value; S.f.arr = ""; renderAll(); });
$("arr").addEventListener("change", e => { S.f.arr = e.target.value; renderAll(); });
function setView(v) {
  $("main").dataset.view = v;
  $("tabMap").setAttribute("aria-selected", String(v === "map"));
  $("tabList").setAttribute("aria-selected", String(v === "list"));
  if (v === "map") setTimeout(() => { map.refresh(); }, 30);
}
$("tabMap").onclick = () => setView("map");
$("tabList").onclick = () => setView("list");

/* ---------- Tiroir (fiche / ajout) ---------- */
let lastFocus = null;
function openSheet(kind, build) {
  lastFocus = document.activeElement;
  S.sheet = kind;
  const sheet = $("sheet");
  build(sheet);
  sheet.hidden = false; $("backdrop").hidden = false;
  sheet.scrollTop = 0;
  const first = sheet.querySelector("[data-autofocus]") || sheet.querySelector("button");
  if (first) first.focus();
}
function closeSheet() {
  $("sheet").hidden = true; $("backdrop").hidden = true;
  S.sheet = null;
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
$("backdrop").onclick = closeSheet;
document.addEventListener("keydown", e => { if (e.key === "Escape" && S.sheet) closeSheet(); });
const closeBtn = () => h("button", { type: "button", class: "icon-btn", "aria-label": "Fermer", "data-autofocus": true, onclick: closeSheet },
  (() => { const sv = s("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }); sv.append(s("path", { d: "M6 6l12 12M18 6 6 18", stroke: "currentColor", "stroke-width": "2.4", "stroke-linecap": "round" })); return sv; })());

function openDetail(id) {
  const p = byId(id); if (!p) return;
  S.selected = id; S.pinned = id; confirmDelete = null;
  const fl = filtered();
  map.setPins(fl, id);
  if (hasGeo(p) && $("main").dataset.view === "map" || window.innerWidth > 860) map.focus(id);
  renderList(fl);
  openSheet("detail", () => renderDetail(id));
}
function starIcon() { const sv = s("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }); sv.append(s("path", { d: "M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2 6.3 20.3l1.2-6.4L2.8 9.5l6.4-.8z", fill: "currentColor", stroke: "var(--muted)", "stroke-width": "1.2", "stroke-linejoin": "round" })); return sv; }
let confirmDelete = null;
function renderDetail(id) {
  const p = byId(id);
  const sheet = $("sheet");
  if (!p) { closeSheet(); return; }
  const r = rating(id), mine = myVote(id), st = statusOf(p);
  const canVote = S.live && p.status === "published";
  const stars = h("div", { class: "stars", role: "group", "aria-label": "Ta note" },
    [1, 2, 3, 4, 5].map(n => h("button", { type: "button", class: "star" + (n <= (mine || Math.round(r.avg)) ? " on" : ""), "aria-label": n + (n > 1 ? " étoiles" : " étoile"), "aria-pressed": String(n === mine), disabled: !canVote, onclick: () => vote(id, n) }, starIcon())));
  const fullAddr = p.address + (p.city && !norm(p.address).includes(norm(p.city)) ? ", " + prettyCity(p.city) : "");
  const copyAddr = h("button", { type: "button", class: "btn btn-small", onclick: async () => {
    try { await navigator.clipboard.writeText(fullAddr); toast("Adresse copiée."); }
    catch (_) { const sp = sheet.querySelector(".addr span"); const range = document.createRange(); range.selectNodeContents(sp); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); toast("Adresse sélectionnée, copie-la avec ton clavier."); }
  } }, "Copier");
  const admin = [];
  if (S.isTeam) {
    if (p.status === "pending") {
      admin.push(h("button", { type: "button", class: "btn btn-small btn-ink", onclick: () => teamUpdate(id, { status: "published", verified: true, checked_at: new Date().toISOString() }, "Plan validé : il est en ligne.") }, "Valider et publier"));
      admin.push(h("button", { type: "button", class: "btn btn-small danger", onclick: () => teamUpdate(id, { status: "hidden", hidden_at: new Date().toISOString() }, "Plan refusé (il est dans la corbeille).", true) }, "Refuser"));
    }
    admin.push(h("button", { type: "button", class: "btn btn-small" + (p.status === "pending" ? "" : " btn-ink"), onclick: () => openEdit(id) }, "Modifier"));
    if (p.status === "published") {
      admin.push(h("button", { type: "button", class: "btn btn-small", onclick: () => teamUpdate(id, { checked_at: new Date().toISOString(), recheck: false, verified: true }, "Marqué comme vérifié aujourd'hui.") }, "Vérifié aujourd'hui"));
      admin.push(confirmDelete === id
        ? h("button", { type: "button", class: "btn btn-small danger", onclick: () => teamUpdate(id, { status: "hidden", hidden_at: new Date().toISOString() }, "Plan supprimé. Tu peux le restaurer depuis Équipe › Corbeille.", true) }, "Confirmer la suppression")
        : h("button", { type: "button", class: "btn btn-small danger", onclick: () => { confirmDelete = id; renderDetail(id); } }, "Supprimer"));
    }
  }
  const photo = S.isTeam && p.photoPath ? h("img", { class: "photo", alt: "Photo de preuve envoyée pour " + p.name, hidden: true }) : null;
  if (photo) S.sb.storage.from("preuves").createSignedUrl(p.photoPath, 3600).then(({ data }) => { if (data && data.signedUrl) { photo.src = data.signedUrl; photo.hidden = false; } }).catch(() => {});
  sheet.setAttribute("aria-labelledby", "sheetTitle");
  sheet.replaceChildren(...[
    h("div", { class: "sheet-top" },
      h("span", { class: "row-meta" }, h("span", { class: "dot", style: `background:${catColor(p.cat)}` }), catLabel(p) + " · " + (p.arr && cityKey(p.city) === "paris" ? "Paris " + arrLabel(p.arr) : prettyCity(p.city))),
      closeBtn()),
    p.status !== "published" ? h("div", { class: "notice" }, h("strong", null, p.status === "pending" ? "En attente de validation" : "Dans la corbeille"), h("span", null, "Ce plan n'est visible que par l'équipe.")) : null,
    h("div", { class: "detail-head" }, h("h2", { id: "sheetTitle" }, p.name), priceEl(p)),
    h("p", { class: "deal" }, p.deal),
    p.cat === "food" && p.veg ? h("div", { class: "box" },
      h("span", { class: "box-label" }, p.veg === "full" ? "100 % végétarien" : "Option végé"),
      h("span", null, p.vegNote || (p.veg === "full" ? "Tout le menu est végétarien." : "Au moins un plat végétarien à ce prix."))) : null,
    p.cond ? h("div", { class: "box" }, h("span", { class: "box-label" }, "Bon à savoir"), h("span", null, p.cond)) : null,
    p.address ? h("div", { class: "box" }, h("span", { class: "box-label" }, "Adresse"), h("div", { class: "addr" }, h("span", null, fullAddr), copyAddr)) : null,
    photo,
    h("div", { class: "links" },
      ficheUrl(p) ? h("a", { class: "btn btn-small btn-ink", href: ficheUrl(p), target: "_blank", rel: "noopener noreferrer nofollow" }, "Voir la fiche") : null,
      h("a", { class: "btn btn-small" + (ficheUrl(p) ? "" : " btn-ink"), href: routeLink(p), target: "_blank", rel: "noopener noreferrer" }, "Itinéraire"),
      isUrl(p.proof) ? h("a", { class: "btn btn-small", href: p.proof, target: "_blank", rel: "noopener noreferrer nofollow" }, "Voir la preuve") : null,
      p.status === "published" ? h("button", { type: "button", class: "btn btn-small", onclick: () => openStory(id) }, "Story Insta") : null),
    p.src ? h("div", { class: "box" },
      h("span", { class: "box-label" }, "Source"),
      h("span", null, isUrl(p.src.url) ? h("a", { href: p.src.url, target: "_blank", rel: "noopener noreferrer" }, p.src.label) : p.src.label, p.src.date ? " · " + p.src.date : ""),
      p.recheck ? h("span", { class: "pill warn", style: "justify-self:start" }, "Prix ou info à reconfirmer") : null) : null,
    p.status === "published" ? h("div", { class: "box" },
      h("span", { class: "box-label" }, "Avis de la communauté"),
      h("div", { class: "rate" }, stars,
        h("span", { class: "rate-avg" }, r.n ? `${r.avg.toFixed(1).replace(".", ",")} / 5 · ${r.n} avis` : "Pas encore d'avis")),
      h("small", { style: "color:var(--muted)" }, canVote ? (mine ? "Merci ! Tu peux changer ta note à tout moment." : "Tu y es allé ? Donne ta note.") : "Les notes s'ouvrent dès que le site est relié à sa base.")) : null,
    h("div", { class: "status" },
      st.kind === "ok" ? h("span", { class: "pill ok" }, p.origin === "community" ? "Proposé par la communauté · vérifié par l'équipe" : "Vérifié par l'équipe")
        : st.kind === "pending" ? h("span", { class: "pill warn" }, "Proposé par la communauté · en attente")
        : p.origin === "community" ? "Proposé par la communauté" : "Base de départ Dix Balles",
      p.origin === "community" && p.createdAt ? "· ajouté le " + fmtDate(p.createdAt) : null,
      p.editedAt ? "· modifié par l'équipe le " + fmtDate(p.editedAt) : null,
      p.checkedAt ? "· dernière vérification le " + fmtDate(p.checkedAt) : null),
    p.status === "published" ? h("div", { class: "report-line" },
      S.myReports[id]
        ? h("span", { class: "status" }, "Merci, ton signalement est bien arrivé à l'équipe.")
        : h("button", { type: "button", class: "link-btn", onclick: () => openReport(id) }, "Prix changé ou lieu fermé ? Signale-le")) : null,
    admin.length ? h("div", { class: "admin" }, h("span", { class: "label-mini", style: "width:100%" }, "Espace équipe"), admin) : null
  ].filter(x => x != null && x !== false));
}

/* ---------- Au hasard ---------- */
let rolling = false;
$("rollBtn").addEventListener("click", () => {
  if (rolling) return;
  const list = filtered();
  const out = $("rollOut");
  if (!list.length) { out.textContent = "Aucun plan avec ces filtres. Élargis la recherche."; return; }
  const pool = list.length > 1 ? list.filter(p => p.id !== S.lastRoll) : list;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  S.lastRoll = pick.id;
  const done = () => { rolling = false; out.textContent = "→ " + pick.name + " · " + fmtPrice(pick.price); openDetail(pick.id); };
  if (reduced()) { done(); return; }
  rolling = true;
  const btn = $("rollBtn"); btn.classList.remove("spinning"); void btn.offsetWidth; btn.classList.add("spinning");
  let i = 0;
  const timer = setInterval(() => {
    out.textContent = list[Math.floor(Math.random() * list.length)].name;
    if (++i > 9) { clearInterval(timer); done(); }
  }, 70);
});

/* ---------- Ajouter un plan ---------- */
$("addBtn").addEventListener("click", openAdd);
function dmNotice(reason) {
  return h("div", { class: "notice" },
    h("strong", null, reason),
    h("span", null, "Envoie-nous ton bon plan en message sur Instagram, on l'ajoute après vérification :"),
    h("div", { class: "addr" }, h("a", { class: "handle", href: INSTAGRAM_URL, target: "_blank", rel: "noopener noreferrer" }, INSTAGRAM),
      h("button", { type: "button", class: "btn btn-small", onclick: async () => { try { await navigator.clipboard.writeText(INSTAGRAM); toast("Pseudo copié."); } catch (_) { toast("Sélectionne le pseudo pour le copier."); } } }, "Copier")),
    h("span", null, "Ce qu'il faut nous envoyer :"),
    h("ul", null, h("li", null, "le nom du lieu et son adresse"), h("li", null, "ce qu'on a pour 10 € maximum"), h("li", null, "le lien de la fiche Google Maps, ou une photo du menu ou du ticket")));
}
function openAdd() {
  openSheet("add", sheet => {
    sheet.setAttribute("aria-labelledby", "addTitle");
    const head = h("div", { class: "sheet-top" }, h("h2", { id: "addTitle" }, "Ajouter un bon plan"), closeBtn());
    if (!S.sb || !S.live) { sheet.replaceChildren(head, dmNotice(S.sb ? "L'ajout est momentanément indisponible." : "L'ajout direct s'ouvre très bientôt.")); return; }
    sheet.replaceChildren(head,
      h("p", { class: "status", style: "margin:0" }, "Pas besoin de compte. L'équipe vérifie chaque plan avant de le mettre en ligne, en général sous 48 h."),
      buildForm());
  });
}
async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    let q = 0.8, blob = await new Promise(r => c.toBlob(r, "image/jpeg", q));
    while (blob && blob.size > 900000 && q > 0.35) { q -= 0.1; blob = await new Promise(r => c.toBlob(r, "image/jpeg", q)); }
    return blob && blob.size <= 1000000 ? blob : null;
  } finally { URL.revokeObjectURL(url); }
}
/* Bloc « où est le lieu ? » : recherche d'adresse + carte, partagé par l'ajout et la modification */
function placeField(prefix, init) {
  const st = { lat: init.lat ?? null, lng: init.lng ?? null, city: init.city || "", postcode: init.postcode || "", arr: init.arr ?? null };
  const address = h("input", { id: prefix + "-address", maxlength: "160", value: init.address || "", placeholder: "Ex. 12 rue de la République, Lyon", autocomplete: "off" });
  const city = h("input", { id: prefix + "-city", maxlength: "60", value: prettyCity(init.city || ""), placeholder: "Ville" });
  const search = h("button", { type: "button", class: "btn btn-small" }, "Chercher");
  const results = h("div", { class: "geo-results" });
  const hint = h("small", null, hasGeo(init) ? "Le point est placé. Déplace-le ou touche la carte pour corriger." : "Cherche l'adresse : le lieu sera placé sur la carte. Tu peux ensuite ajuster le point.");
  const mapEl = h("div", { class: "pick-leaflet", role: "region", "aria-label": "Carte pour placer le lieu" });
  let pm = null;
  const ensureMap = () => { if (!pm) pm = makePickMap(mapEl, hasGeo(init) ? [init.lat, init.lng] : null, (lat, lng) => { st.lat = lat; st.lng = lng; hint.textContent = "Point placé. Tu peux encore le déplacer."; }); pm.refresh(); };
  const choose = r => {
    address.value = [r.street, r.postcode].filter(Boolean).join(", ") + (r.city ? " " + r.city : "");
    city.value = r.city; st.city = r.city; st.postcode = r.postcode; st.arr = r.arr; st.lat = +r.lat.toFixed(6); st.lng = +r.lng.toFixed(6);
    results.replaceChildren(); ensureMap(); pm.set(st.lat, st.lng, 17);
    hint.textContent = "Adresse trouvée et placée sur la carte. Ajuste le point si besoin.";
  };
  const run = async () => {
    const q = address.value.trim();
    if (q.length < 4) { hint.textContent = "Tape au moins le nom de la rue et la ville."; return; }
    search.disabled = true; search.textContent = "…";
    try {
      const rs = await geocode(q, 5);
      results.replaceChildren(...(rs.length ? rs.map(r => h("button", { type: "button", onclick: () => choose(r) }, r.label)) : [h("small", null, "Aucune adresse trouvée. Précise la ville, ou place le lieu directement sur la carte.")]));
      ensureMap();
    } catch (_) { hint.textContent = "La recherche d'adresse ne répond pas. Indique la ville et place le point sur la carte."; ensureMap(); }
    finally { search.disabled = false; search.textContent = "Chercher"; }
  };
  search.addEventListener("click", run);
  address.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); run(); } });
  city.addEventListener("input", () => { st.city = city.value; if (cityKey(city.value) !== "paris") st.arr = null; });
  const el = h("div", { class: "form", style: "gap:10px" },
    h("div", { class: "field" }, h("label", { for: prefix + "-address" }, "Adresse"), h("div", { class: "geo-row" }, address, search), results),
    h("div", { class: "field" }, h("label", { for: prefix + "-city" }, "Ville"), city),
    h("div", { class: "field" }, h("span", { class: "lbl" }, "Position sur la carte"), mapEl, hint,
      h("div", null, h("button", { type: "button", class: "btn btn-small", onclick: () => { st.lat = st.lng = null; ensureMap(); pm.set(null); hint.textContent = "Le lieu n'apparaîtra pas sur la carte, seulement dans la liste."; } }, "Retirer de la carte"))));
  setTimeout(ensureMap, 0);
  return { el, state: st, address, city, focus: () => address.focus() };
}
function buildForm() {
  let photo = null;
  const field = (label, input, hint) => h("div", { class: "field" }, h("label", { for: input.id }, label), input, hint ? h("small", null, hint) : null);
  const name = h("input", { id: "f-name", required: true, maxlength: "80", placeholder: "Ex. Chez Ali, Rooftop du Printemps…" });
  const cat = h("select", { id: "f-cat" }, Object.entries(CATS).map(([k, c]) => h("option", { value: k }, c.label)));
  const sub = h("select", { id: "f-sub" }, Object.entries(SUBS).map(([k, v]) => h("option", { value: k }, v)));
  const subField = h("div", { class: "field" }, h("label", { for: "f-sub" }, "Type de bon plan"), sub);
  const veg = vegSelect("f-veg", null);
  const vegNote = h("input", { id: "f-vegnote", maxlength: "120", placeholder: "Le plat végé et son prix, ex. falafels à 6 €" });
  const vegField = h("div", { class: "field" }, h("label", { for: "f-veg" }, "Végétarien"), veg, vegNote);
  const syncSub = () => { subField.hidden = vegField.hidden = cat.value !== "food"; vegNote.hidden = !veg.value; };
  veg.addEventListener("change", syncSub);
  cat.addEventListener("change", syncSub);
  const where = placeField("f", { city: S.f.city ? (cityCounts().get(S.f.city) || {}).name : "" });
  const price = h("input", { id: "f-price", type: "number", required: true, min: "0", max: "10", step: "0.1", inputmode: "decimal", placeholder: "0 si gratuit" });
  const deal = h("textarea", { id: "f-deal", required: true, maxlength: "220", placeholder: "Ex. Le menu kebab + frites + boisson à 8 €" });
  const cond = h("input", { id: "f-cond", maxlength: "160", placeholder: "Ex. Seulement le midi, -26 ans, fermé le lundi" });
  const placeLink = h("input", { id: "f-place", type: "url", maxlength: "500", inputmode: "url", placeholder: "https://maps.app.goo.gl/… ou le site du lieu" });
  const proof = h("input", { id: "f-proof", type: "url", maxlength: "400", placeholder: "https://… (menu en ligne, post Insta, article)" });
  const photoIn = h("input", { id: "f-photo", type: "file", accept: "image/*" });
  const photoPrev = h("img", { class: "photo", alt: "Aperçu de la preuve", hidden: true });
  const err = h("div", { class: "form-error", role: "alert" });
  photoIn.addEventListener("change", async () => {
    const f = photoIn.files && photoIn.files[0]; photo = null; photoPrev.hidden = true; err.textContent = "";
    if (!f) return;
    try { photo = await compressImage(f); } catch (_) { photo = null; }
    if (photo) { photoPrev.src = URL.createObjectURL(photo); photoPrev.hidden = false; } else { err.textContent = "Cette image n'a pas pu être lue. Essaie une autre photo, ou mets un lien."; }
  });
  const submit = h("button", { type: "submit", class: "btn btn-ink" }, "Envoyer le bon plan");
  const form = h("form", { class: "form", novalidate: true },
    field("Nom du lieu", name),
    h("div", { class: "two" }, field("Catégorie", cat), field("Prix payé (€)", price, "10 € maximum.")),
    subField,
    vegField,
    field("Ce que tu as pour ce prix", deal, "Sois précis : c'est ce qui fait un vrai bon plan."),
    where.el,
    field("Lien de la fiche Google Maps ou du site", placeLink, "Sur Google Maps : Partager, puis Copier le lien. Ce lien compte comme preuve."),
    field("Bon à savoir (facultatif)", cond),
    h("div", { class: "notice" },
      h("strong", null, "La preuve (obligatoire)"),
      h("span", null, "Le lien de la fiche ci-dessus suffit. Sinon, une photo du menu ou du ticket, ou un autre lien. La photo n'est vue que par l'équipe."),
      field("Photo", photoIn), photoPrev, field("ou un lien", proof)),
    h("small", { class: "status" }, "Pas de nom, pas d'e-mail : on ne te demande rien sur toi. N'écris pas d'information personnelle."),
    err, submit);
  form.addEventListener("submit", async e => {
    e.preventDefault(); err.textContent = "";
    const fail = (msg, el) => { err.textContent = msg; if (el && el.focus) el.focus(); };
    const pv = parseFloat(String(price.value).replace(",", "."));
    if (!name.value.trim()) return fail("Donne un nom au lieu.", name);
    if (Number.isNaN(pv) || pv < 0) return fail("Indique le prix payé (0 si c'est gratuit).", price);
    if (pv > 10) return fail("Ici, c'est 10 € maximum. Au-dessus, ce n'est pas un plan Dix Balles.", price);
    if (!deal.value.trim()) return fail("Explique ce qu'on a pour ce prix.", deal);
    if (!where.address.value.trim()) return fail("Indique l'adresse.", where.address);
    if (!where.city.value.trim()) return fail("Indique la ville.", where.city);
    const link = proof.value.trim(), place = placeLink.value.trim();
    if (place && !isUrl(place)) return fail("Le lien de la fiche doit commencer par https://", placeLink);
    if (link && !isUrl(link)) return fail("Le lien doit commencer par https://", proof);
    if (!photo && !link && !place) return fail("Ajoute une preuve : le lien de la fiche, une photo ou un lien.", placeLink);
    const st = where.state, city = prettyCity(where.city.value.trim()).slice(0, 60);
    submit.disabled = true; submit.textContent = "Envoi…";
    try {
      let photoPath = null;
      if (photo) {
        photoPath = new Date().toISOString().slice(0, 10) + "/" + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2)) + ".jpg";
        const up = await S.sb.storage.from("preuves").upload(photoPath, photo, { contentType: "image/jpeg", upsert: false });
        if (up.error) throw up.error;
      }
      const row = {
        name: name.value.trim().slice(0, 80), cat: cat.value, sub: cat.value === "food" ? sub.value : null,
        veg: cat.value === "food" && veg.value ? veg.value : null, veg_note: cat.value === "food" && veg.value ? vegNote.value.trim().slice(0, 120) : "",
        price: Math.round(pv * 100) / 100, deal: deal.value.trim().slice(0, 220), cond: cond.value.trim().slice(0, 160),
        address: where.address.value.trim().slice(0, 160), city, postcode: st.postcode || null,
        arr: cityKey(city) === "paris" && st.arr ? st.arr : null, lat: st.lat, lng: st.lng,
        fiche_link: place || null, proof_link: link || null, proof_photo: photoPath,
        status: "pending", origin: "community", device: DEVICE
      };
      const { error } = await S.sb.from("plans").insert(row);
      if (error) throw error;
      sheetThanks(row);
    } catch (e2) {
      submit.disabled = false; submit.textContent = "Envoyer le bon plan";
      const msg = e2 && e2.message ? String(e2.message) : "";
      err.textContent = /Trop d/.test(msg) ? msg : "L'envoi n'a pas abouti. Vérifie ta connexion et réessaie. Sinon, écris-nous sur Instagram : " + INSTAGRAM;
    }
  });
  syncSub();
  return form;
}
function sheetThanks(row) {
  const sheet = $("sheet");
  sheet.replaceChildren(
    h("div", { class: "sheet-top" }, h("h2", { id: "addTitle" }, "Merci !"), closeBtn()),
    h("div", { class: "callout" },
      h("strong", null, "Ton plan est bien arrivé"),
      h("p", null, `« ${row.name} » à ${row.city} : l'équipe le vérifie avant de le mettre en ligne, en général sous 48 h.`)),
    h("p", { class: "deal", style: "font-size:16px" }, "Tu peux nous suivre sur Instagram pour voir les nouveaux plans de ta ville passer."),
    h("div", { class: "links" },
      h("a", { class: "btn btn-ink", href: INSTAGRAM_URL, target: "_blank", rel: "noopener noreferrer" }, "Suivre " + INSTAGRAM),
      h("button", { type: "button", class: "btn", onclick: openAdd }, "Ajouter un autre plan")));
}

/* ---------- Notes et signalements ---------- */
async function vote(id, n) {
  if (!S.sb || !S.live) return;
  const prev = S.myRatings[id];
  S.myRatings = { ...S.myRatings, [id]: n }; store.set("dixballes.ratings", S.myRatings);
  renderDetail(id);
  try {
    const { error } = await S.sb.rpc("rate_plan", { p_plan: id, p_device: DEVICE, p_stars: n });
    if (error) throw error;
    const { data } = await S.sb.rpc("plan_ratings");
    S.ratings = Object.fromEntries((data || []).map(r => [r.plan_id, { avg: Number(r.avg), n: Number(r.n) }]));
    toast("Merci pour ta note.");
  } catch (_) {
    S.myRatings = { ...S.myRatings }; if (prev) S.myRatings[id] = prev; else delete S.myRatings[id];
    store.set("dixballes.ratings", S.myRatings);
    toast("Ta note n'a pas été enregistrée. Réessaie dans un instant.");
  }
  renderAll();
}
const REPORT_TYPES = { price: "Le prix a changé", closed: "Le lieu est fermé", other: "Autre problème" };
function openReport(id) {
  const p = byId(id); if (!p) return;
  openSheet("report", sheet => {
    sheet.setAttribute("aria-labelledby", "reportTitle");
    const head = h("div", { class: "sheet-top" }, h("h2", { id: "reportTitle" }, "Signaler un problème"), closeBtn());
    if (!S.sb || !S.live) { sheet.replaceChildren(head, dmNotice("Le signalement direct s'ouvre très bientôt.")); return; }
    const radios = Object.entries(REPORT_TYPES).map(([k, label], i) => h("label", { for: "rt-" + k }, h("input", { type: "radio", name: "r-type", id: "rt-" + k, value: k, checked: i === 0 }), label));
    const price = h("input", { id: "r-price", type: "number", min: "0", max: "999", step: "0.01", inputmode: "decimal", placeholder: "Ex. 11,50" });
    const priceField = h("div", { class: "field" }, h("label", { for: "r-price" }, "Prix constaté (facultatif)"), price);
    const note = h("textarea", { id: "r-note", maxlength: "200", placeholder: "Ex. Le menu est passé à 11 € depuis la rentrée." });
    const err = h("div", { class: "form-error", role: "alert" });
    const submit = h("button", { type: "submit", class: "btn btn-ink" }, "Envoyer le signalement");
    const form = h("form", { class: "form", novalidate: true },
      h("p", { class: "deal", style: "font-size:16px" }, h("strong", null, p.name), " · " + fmtPrice(p.price)),
      h("div", { class: "radio-list", role: "radiogroup", "aria-label": "Type de problème" }, radios),
      priceField,
      h("div", { class: "field" }, h("label", { for: "r-note" }, "Précisions (facultatif)"), note, h("small", null, "N'écris pas d'information personnelle.")),
      err, submit);
    const sync = () => { priceField.hidden = form.querySelector("input[name=r-type]:checked").value !== "price"; };
    form.addEventListener("change", sync);
    form.addEventListener("submit", async e => {
      e.preventDefault(); err.textContent = "";
      const type = form.querySelector("input[name=r-type]:checked").value;
      const pv = price.value === "" ? null : parseFloat(String(price.value).replace(",", "."));
      if (type === "price" && pv !== null && (Number.isNaN(pv) || pv < 0 || pv >= 1000)) { err.textContent = "Le prix doit être un nombre positif."; price.focus(); return; }
      submit.disabled = true; submit.textContent = "Envoi…";
      try {
        const { error } = await S.sb.from("reports").insert({ plan_id: id, type, price: type === "price" && pv !== null ? Math.round(pv * 100) / 100 : null, note: note.value.trim().slice(0, 200), device: DEVICE });
        if (error) throw error;
        S.myReports = { ...S.myReports, [id]: Date.now() }; store.set("dixballes.reports", S.myReports);
        toast("Merci ! L'équipe va vérifier.");
        openDetail(id);
      } catch (e2) {
        submit.disabled = false; submit.textContent = "Envoyer le signalement";
        const msg = e2 && e2.message ? String(e2.message) : "";
        err.textContent = /Trop d/.test(msg) ? msg : "Le signalement n'est pas parti. Vérifie ta connexion et réessaie.";
      }
    });
    sheet.replaceChildren(head, form);
    sync();
  });
}

/* ---------- Espace équipe ---------- */
async function teamUpdate(id, patch, msg, close) {
  try {
    const { error } = await S.sb.from("plans").update(patch).eq("id", id);
    if (error) throw error;
    confirmDelete = null;
    toast(msg);
    if (close) closeSheet();
    await loadData();
  } catch (_) { toast("L'action n'a pas abouti. Vérifie ta connexion et réessaie."); }
}
async function deleteForever(p) {
  try {
    if (p.photoPath) await S.sb.storage.from("preuves").remove([p.photoPath]);
    const { error } = await S.sb.from("plans").delete().eq("id", p.id);
    if (error) throw error;
    toast("Plan supprimé définitivement.");
    await loadData();
  } catch (_) { toast("La suppression n'a pas abouti. Réessaie."); }
}
async function resolveReport(rid) {
  try {
    const { error } = await S.sb.from("reports").update({ resolved: true }).eq("id", rid);
    if (error) throw error;
    toast("Signalement marqué comme traité.");
    await loadData();
  } catch (_) { toast("L'action n'a pas abouti. Réessaie."); }
}
function openEdit(id) {
  const p = byIdAny(id); if (!p) return;
  openSheet("edit", sheet => {
    sheet.setAttribute("aria-labelledby", "editTitle");
    sheet.replaceChildren(h("div", { class: "sheet-top" }, h("h2", { id: "editTitle" }, "Modifier le plan"), closeBtn()), buildEditForm(p));
  });
}
function buildEditForm(p) {
  const fld = (label, input, hint) => h("div", { class: "field" }, h("label", { for: input.id }, label), input, hint ? h("small", null, hint) : null);
  const name = h("input", { id: "e-name", maxlength: "80", value: p.name });
  const cat = h("select", { id: "e-cat" }, Object.entries(CATS).map(([k, c]) => h("option", { value: k, selected: k === p.cat }, c.label)));
  const sub = h("select", { id: "e-sub" }, Object.entries(SUBS).map(([k, v]) => h("option", { value: k, selected: k === p.sub }, v)));
  const subField = fld("Type de bon plan", sub);
  const veg = vegSelect("e-veg", p.veg);
  const vegNote = h("input", { id: "e-vegnote", maxlength: "120", value: p.vegNote || "", placeholder: "Le plat végé et son prix, ex. falafels à 6 €" });
  const vegField = h("div", { class: "field" }, h("label", { for: "e-veg" }, "Végétarien"), veg, vegNote);
  const syncSub = () => { subField.hidden = vegField.hidden = cat.value !== "food"; vegNote.hidden = !veg.value; };
  veg.addEventListener("change", syncSub);
  cat.addEventListener("change", syncSub);
  const price = h("input", { id: "e-price", type: "number", min: "0", max: "10", step: "0.01", inputmode: "decimal", value: String(p.price) });
  const deal = h("textarea", { id: "e-deal", maxlength: "240" }); deal.value = p.deal || "";
  const cond = h("textarea", { id: "e-cond", maxlength: "300" }); cond.value = p.cond || "";
  const where = placeField("e", p);
  const arr = h("select", { id: "e-arr" }, h("option", { value: "" }, "Non précisé"), Array.from({ length: 20 }, (_, i) => h("option", { value: String(i + 1), selected: p.arr === i + 1 }, arrLabel(i + 1))));
  const arrField = fld("Arrondissement (Paris)", arr);
  const syncArr = () => { arrField.hidden = cityKey(where.city.value) !== "paris"; };
  where.city.addEventListener("input", syncArr);
  const link = h("input", { id: "e-link", type: "url", maxlength: "600", value: ficheUrl(p) || "", placeholder: "https://maps.app.goo.gl/… ou le site du lieu" });
  const recheck = h("input", { id: "e-recheck", type: "checkbox", checked: !!p.recheck });
  const err = h("div", { class: "form-error", role: "alert" });
  const submit = h("button", { type: "submit", class: "btn btn-ink" }, "Enregistrer les modifications");
  const form = h("form", { class: "form", novalidate: true },
    fld("Nom du lieu", name),
    h("div", { class: "two" }, fld("Catégorie", cat), fld("Prix (€)", price, "10 € maximum. 0 si c'est gratuit.")),
    subField, vegField,
    fld("Le bon plan", deal),
    fld("Bon à savoir", cond),
    where.el, arrField,
    fld("Lien de la fiche Google Maps ou du site", link, "Laisse vide pour retirer le bouton « Voir la fiche »."),
    h("label", { class: "check", for: "e-recheck" }, recheck, "Prix ou info à reconfirmer"),
    err,
    h("div", { class: "links" }, submit, h("button", { type: "button", class: "btn", onclick: () => openDetail(p.id) }, "Annuler")));
  form.addEventListener("submit", async e => {
    e.preventDefault(); err.textContent = "";
    const fail = (msg, el) => { err.textContent = msg; if (el && el.focus) el.focus(); };
    const pv = parseFloat(String(price.value).replace(",", "."));
    if (!name.value.trim()) return fail("Le nom du lieu ne peut pas être vide.", name);
    if (Number.isNaN(pv) || pv < 0) return fail("Indique un prix (0 si c'est gratuit).", price);
    if (pv > 10) return fail("10 € maximum : au-dessus, ce n'est pas un plan Dix Balles.", price);
    if (!deal.value.trim()) return fail("Explique ce qu'on a pour ce prix.", deal);
    if (!where.city.value.trim()) return fail("Indique la ville.", where.city);
    const lk = link.value.trim();
    if (lk && !isUrl(lk)) return fail("Le lien doit commencer par https://", link);
    const st = where.state, city = prettyCity(where.city.value.trim()).slice(0, 60);
    const moved = st.lat !== p.lat || st.lng !== p.lng;
    const patch = {
      name: name.value.trim().slice(0, 80), cat: cat.value, sub: cat.value === "food" ? sub.value : null,
      veg: cat.value === "food" && veg.value ? veg.value : null, veg_note: cat.value === "food" && veg.value ? vegNote.value.trim().slice(0, 120) : "",
      price: Math.round(pv * 100) / 100, deal: deal.value.trim().slice(0, 240), cond: cond.value.trim().slice(0, 300),
      address: where.address.value.trim().slice(0, 160), city, postcode: st.postcode || p.postcode || null,
      arr: cityKey(city) === "paris" && arr.value ? Number(arr.value) : (cityKey(city) === "paris" && st.arr ? st.arr : null),
      lat: st.lat, lng: st.lng, fiche_link: lk || null, recheck: recheck.checked, edited_at: new Date().toISOString()
    };
    if (moved || (lk || null) !== (p.ficheLink || null)) patch.place_id = null;
    submit.disabled = true; submit.textContent = "Enregistrement…";
    try {
      const { error } = await S.sb.from("plans").update(patch).eq("id", p.id);
      if (error) throw error;
      toast("Modifications enregistrées.");
      await loadData();
      openDetail(p.id);
    } catch (_) {
      submit.disabled = false; submit.textContent = "Enregistrer les modifications";
      toast("La modification n'a pas été enregistrée. Vérifie ta connexion et réessaie.");
    }
  });
  syncSub(); syncArr();
  return form;
}
$("teamBtn").addEventListener("click", () => openSheet("team", () => renderTeam()));
$("teamLogin").addEventListener("click", () => {
  if (S.isTeam) { openSheet("team", () => renderTeam()); return; }
  if (S.email) { S.sb.auth.signOut().then(checkTeam); toast("Tu es déconnecté."); return; }
  openLogin();
});
function openLogin() {
  openSheet("login", sheet => {
    sheet.setAttribute("aria-labelledby", "loginTitle");
    const head = h("div", { class: "sheet-top" }, h("h2", { id: "loginTitle" }, "Accès équipe"), closeBtn());
    if (!S.sb) { sheet.replaceChildren(head, h("p", { class: "status" }, "La base n'est pas encore reliée au site.")); return; }
    const email = h("input", { id: "l-email", type: "email", required: true, autocomplete: "email", placeholder: "ton.adresse@exemple.fr" });
    const err = h("div", { class: "form-error", role: "alert" });
    const submit = h("button", { type: "submit", class: "btn btn-ink" }, "Recevoir le lien de connexion");
    const form = h("form", { class: "form", novalidate: true },
      h("p", { class: "status", style: "margin:0" }, "Réservé aux membres de l'équipe Dix Balles. Tu reçois un lien par e-mail : ouvre-le sur cet appareil."),
      h("div", { class: "field" }, h("label", { for: "l-email" }, "Ton e-mail"), email), err, submit);
    form.addEventListener("submit", async e => {
      e.preventDefault(); err.textContent = "";
      const v = email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { err.textContent = "Cette adresse ne semble pas valide."; email.focus(); return; }
      submit.disabled = true; submit.textContent = "Envoi…";
      const { error } = await S.sb.auth.signInWithOtp({ email: v, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) { submit.disabled = false; submit.textContent = "Recevoir le lien de connexion"; err.textContent = /rate|limit/i.test(error.message) ? "Trop de demandes : attends quelques minutes avant de réessayer." : "L'envoi n'a pas abouti. Réessaie."; return; }
      sheet.replaceChildren(head, h("div", { class: "notice" }, h("strong", null, "Regarde ta boîte mail"), h("span", null, "Ouvre le lien reçu sur cet appareil pour te connecter. Pense à vérifier les spams.")));
    });
    sheet.replaceChildren(head, form);
  });
}
let confirmPurge = null;
function renderTeam() {
  const sheet = $("sheet");
  sheet.setAttribute("aria-labelledby", "teamTitle");
  const head = h("div", { class: "sheet-top" }, h("h2", { id: "teamTitle" }, "Espace équipe"), closeBtn());
  if (!S.isTeam) { sheet.replaceChildren(head, h("p", { class: "status" }, "Connecte-toi avec un e-mail de l'équipe.")); return; }
  const pending = S.plans.filter(p => p.status === "pending").sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const trash = S.plans.filter(p => p.status === "hidden").sort((a, b) => (b.hiddenAt || 0) - (a.hiddenAt || 0));
  const openRow = p => h("button", { type: "button", class: "link-btn", onclick: () => openDetail(p.id) }, p.name);
  sheet.replaceChildren(
    head,
    h("div", { class: "notice" },
      h("span", null, "Connecté : " + S.email + ". Ouvre n'importe quel plan pour le modifier, le vérifier ou le supprimer."),
      h("span", { class: "status" }, `${allPlaces().length} plans en ligne · ${pending.length} en attente · ${trash.length} dans la corbeille`),
      h("div", null, h("button", { type: "button", class: "btn btn-small", onclick: async () => { await S.sb.auth.signOut(); closeSheet(); await checkTeam(); toast("Tu es déconnecté."); } }, "Se déconnecter"))),
    h("button", { type: "button", class: "btn btn-ink", onclick: openCarousel }, "Créer un carrousel Insta"),
    h("div", { class: "box" },
      h("span", { class: "box-label" }, `Ajouts à valider (${pending.length})`),
      pending.length ? pending.map(p => h("div", { class: "trash-row" },
        h("span", null, openRow(p), h("br"), h("small", { style: "color:var(--muted)" }, `${fmtPrice(p.price)} · ${prettyCity(p.city)}${p.createdAt ? " · reçu le " + fmtDate(p.createdAt) : ""}${p.photoPath ? " · photo" : ""}`)),
        h("button", { type: "button", class: "btn btn-small btn-ink", onclick: () => openDetail(p.id) }, "Examiner"))) : h("span", { class: "status" }, "Aucun ajout en attente.")),
    h("div", { class: "box" },
      h("span", { class: "box-label" }, `Signalements (${S.reports.length})`),
      S.reports.length ? S.reports.map(r => {
        const p = byIdAny(r.plan_id);
        return h("div", { class: "trash-row" },
          h("span", null,
            p ? openRow(p) : h("strong", null, "Plan introuvable"), h("br"),
            h("small", { style: "color:var(--muted)" }, REPORT_TYPES[r.type] + (r.price != null ? " · prix constaté : " + fmtPrice(Number(r.price)) : "") + " · le " + fmtDate(r.created_at)),
            r.note ? h("span", { style: "display:block;font-size:14px;overflow-wrap:anywhere" }, "« " + r.note + " »") : null),
          h("button", { type: "button", class: "btn btn-small", onclick: () => resolveReport(r.id) }, "Traité"));
      }) : h("span", { class: "status" }, "Aucun signalement.")),
    h("div", { class: "box" },
      h("span", { class: "box-label" }, `Corbeille (${trash.length})`),
      trash.length ? trash.map(p => h("div", { class: "trash-row" },
        h("span", null, h("strong", null, p.name), h("br"), h("small", { style: "color:var(--muted)" }, (p.origin === "seed" ? "Base de départ" : "Ajout communauté") + (p.hiddenAt ? " · retiré le " + fmtDate(p.hiddenAt) : ""))),
        h("div", { class: "links" },
          h("button", { type: "button", class: "btn btn-small", onclick: () => teamUpdate(p.id, { status: "published", hidden_at: null }, "Plan restauré.") }, "Restaurer"),
          p.origin === "community" ? (confirmPurge === p.id
            ? h("button", { type: "button", class: "btn btn-small danger", onclick: () => { confirmPurge = null; deleteForever(p); } }, "Confirmer")
            : h("button", { type: "button", class: "btn btn-small danger", onclick: () => { confirmPurge = p.id; renderTeam(); } }, "Supprimer définitivement")) : null)))
        : h("span", { class: "status" }, "La corbeille est vide."))
  );
}

/* ---------- Téléchargement des visuels ---------- */
const isTouch = () => window.matchMedia("(pointer: coarse)").matches;
async function saveFile(name, blob) {
  try {
    const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
    if (isTouch() && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return true; }
  } catch (e) { if (e && e.name === "AbortError") return false; }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  toast("Fichier téléchargé.");
  return true;
}
async function shareFiles(files) {
  try { if (navigator.canShare && navigator.canShare({ files })) { await navigator.share({ files }); return true; } } catch (e) { if (e && e.name === "AbortError") return false; }
  return false;
}

/* ---------- Visuel story Instagram (1080 × 1920) ---------- */
function wrapText(x, text, maxW) {
  const words = String(text).split(/[ \t\n]+/); const lines = []; let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (x.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}
function fitFont(x, text, weight, size, family, maxW, min) {
  let s = size;
  do { x.font = `${weight} ${s}px ${family}`; if (x.measureText(text).width <= maxW) break; s -= 2; } while (s > (min || 20));
  return s;
}
async function drawStory(p) {
  try { await Promise.all(['900 140px "Big Shoulders Display"', '700 48px "Atkinson Hyperlegible"', '400 48px "Atkinson Hyperlegible"'].map(f => document.fonts.load(f))); } catch (_) {}
  const W = 1080, H = 1920, M = 90;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d");
  const INK = "#131A2B", YEL = "#FFCB1F", WHITE = "#FFFFFF", SOFT = "#C5CDDB";
  const CAT = { food: "#FF7A52", culture: "#6FA2EE", vue: "#B48CF2", balade: "#4CC883", soiree: "#F06AAE", cine: "#4FC3BC", autre: "#9AA5B9" };
  const D = '"Big Shoulders Display", "Arial Narrow", Impact, sans-serif', B = '"Atkinson Hyperlegible", "Segoe UI", Arial, sans-serif';
  x.fillStyle = INK; x.fillRect(0, 0, W, H);
  // Marque
  x.save(); x.translate(M + 62, 190); x.rotate(-12 * Math.PI / 180);
  x.fillStyle = YEL; x.beginPath(); x.arc(0, 0, 62, 0, Math.PI * 2); x.fill();
  x.fillStyle = INK; x.textAlign = "center"; x.textBaseline = "middle"; x.font = `900 24px ${D}`; x.fillText("MAX", 0, -20); x.font = `900 40px ${D}`; x.fillText("10€", 0, 12);
  x.restore();
  x.fillStyle = WHITE; x.textAlign = "left"; x.textBaseline = "alphabetic"; x.font = `900 76px ${D}`; x.fillText("DIX BALLES", M + 150, 216);
  // Catégorie
  let y = 420;
  x.fillStyle = CAT[p.cat] || CAT.autre; x.beginPath(); x.arc(M + 14, y - 14, 14, 0, Math.PI * 2); x.fill();
  x.fillStyle = WHITE;
  const where = p.arr && cityKey(p.city) === "paris" ? "Paris " + arrLabel(p.arr) : prettyCity(p.city);
  const catLine = (catLabel(p) + " · " + where).toUpperCase();
  fitFont(x, catLine, 700, 40, B, W - 2 * M - 44, 24);
  x.fillText(catLine, M + 44, y);
  // Nom du lieu
  y += 60;
  let size = 150, lines;
  do { x.font = `900 ${size}px ${D}`; lines = wrapText(x, p.name.toUpperCase(), W - 2 * M); size -= 10; } while ((lines.length > 3 || lines.some(l => x.measureText(l).width > W - 2 * M)) && size > 70);
  size += 10; x.fillStyle = WHITE;
  for (const l of lines) { y += size * 0.92; x.fillText(l, M, y); }
  // Étiquette prix
  y += 70;
  const label = fmtPrice(p.price).toUpperCase();
  x.font = `900 130px ${D}`;
  const tw = x.measureText(label).width + 80, th = 170;
  x.save(); x.translate(M + tw / 2, y + th / 2); x.rotate(-4 * Math.PI / 180);
  x.fillStyle = YEL; x.beginPath(); x.roundRect(-tw / 2, -th / 2, tw, th, 22); x.fill();
  x.lineWidth = 6; x.strokeStyle = WHITE; x.stroke();
  x.fillStyle = INK; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(label, 0, 8);
  x.restore(); x.textAlign = "left"; x.textBaseline = "alphabetic";
  // Le bon plan
  y += th + 110;
  x.font = `400 52px ${B}`; x.fillStyle = WHITE;
  for (const l of wrapText(x, p.deal, W - 2 * M).slice(0, 6)) { x.fillText(l, M, y); y += 70; }
  // Adresse
  if (p.address) { y += 20; x.font = `700 40px ${B}`; x.fillStyle = SOFT; for (const l of wrapText(x, p.address, W - 2 * M).slice(0, 2)) { x.fillText(l, M, y); y += 54; } }
  // Bandeau final
  x.fillStyle = YEL; x.fillRect(0, H - 300, W, 300);
  x.fillStyle = INK; fitFont(x, "RIEN AU-DESSUS DE 10\u00a0€.", 900, 92, D, W - 2 * M, 40); x.fillText("RIEN AU-DESSUS DE 10\u00a0€.", M, H - 170);
  fitFont(x, "Tous les bons plans sur " + INSTAGRAM, 700, 44, B, W - 2 * M, 24); x.fillText("Tous les bons plans sur " + INSTAGRAM, M, H - 95);
  return c;
}
function openStory(id) {
  const p = byId(id); if (!p) return;
  openSheet("story", sheet => {
    sheet.setAttribute("aria-labelledby", "storyTitle");
    const head = h("div", { class: "sheet-top" }, h("h2", { id: "storyTitle" }, "Story Insta"), closeBtn());
    const slot = h("div", { class: "status" }, "Création de l'image…");
    sheet.replaceChildren(head, slot);
    drawStory(p).then(c => {
      if (S.sheet !== "story") return;
      const img = h("img", { class: "story-preview", src: c.toDataURL("image/png"), alt: "Aperçu de la story pour " + p.name });
      const caption = `${p.name} · ${fmtPrice(p.price)} · ${whereLabel(p)}\n${p.deal}\nTous les bons plans à 10 € max : ${INSTAGRAM}`;
      const save = h("button", { type: "button", class: "btn btn-ink", onclick: () => c.toBlob(blob => { if (!blob) { toast("L'image n'a pas pu être créée."); return; } saveFile("dixballes-" + norm(p.name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".png", blob); }, "image/png") }, "Télécharger l'image");
      const copy = h("button", { type: "button", class: "btn", onclick: async () => {
        try { await navigator.clipboard.writeText(caption); toast("Légende copiée."); } catch (_) { toast("Sélectionne la légende pour la copier."); }
      } }, "Copier la légende");
      sheet.replaceChildren(head, img, h("div", { class: "links" }, save, copy),
        h("div", { class: "box" }, h("span", { class: "box-label" }, "Légende proposée"), h("span", { style: "white-space:pre-line;user-select:text" }, caption)),
        h("small", { class: "status" }, "Format 1080 × 1920, prêt pour une story. Pense à identifier le lieu."));
    });
  });
}

/* ---------- Carrousel Instagram (1080 × 1350) ---------- */
const CAR = { picks: [], preset: "food5", title: "Les bons plans de la semaine", slides: null, busy: false };
const PRESETS = {
  food5: ["Manger à 5 € ou moins", () => allPlaces().filter(p => p.cat === "food" && p.price <= 5)],
  food: ["Manger à 10 € max", () => allPlaces().filter(p => p.cat === "food")],
  veg: ["Végé", () => allPlaces().filter(p => p.cat === "food" && p.veg)],
  sweet: ["Sucré", () => allPlaces().filter(p => p.cat === "food" && p.sub === "sucre")],
  free: ["Sorties gratuites", () => allPlaces().filter(p => p.price === 0)],
  filters: ["Les filtres actuels de la page", () => filtered()],
  random: ["Au hasard", () => allPlaces().slice().sort(() => Math.random() - 0.5)]
};
function weekLabel() {
  const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return "Semaine du " + d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
}
function carPlace() {
  const ps = (CAR.plans || CAR.picks.map(byId)).filter(Boolean);
  const cs = [...new Set(ps.map(p => prettyCity(p.city)))];
  return cs.length === 1 ? cs[0] : "Partout en France";
}
const presetPicks = () => PRESETS[CAR.preset][1]().slice(0, 5).map(p => p.id);
function openCarousel() {
  CAR.slides = null;
  if (!CAR.picks.length) CAR.picks = presetPicks();
  openSheet("carousel", () => renderCarousel());
}
function carCaption(plans) {
  return `${CAR.title} · ${weekLabel()}\n\n` +
    plans.map((p, i) => `${i + 1}. ${p.name} · ${fmtPrice(p.price)} · ${whereLabel(p)}`).join("\n") +
    `\n\nEnregistre ce post pour plus tard, et envoie-le à la personne avec qui tu y vas.\nToutes les adresses à 10 € max : ${INSTAGRAM}\n\n#bonplanparis #parispascher #etudiantparis #sortirparis #dixballes`;
}
const toBlob = c => new Promise(r => c.toBlob(r, "image/png"));
function renderCarousel() {
  const sheet = $("sheet");
  sheet.setAttribute("aria-labelledby", "carTitle");
  const head = h("div", { class: "sheet-top" }, h("h2", { id: "carTitle" }, "Carrousel Insta"), closeBtn());
  const preset = h("select", { id: "c-preset" }, Object.entries(PRESETS).map(([k, [l]]) => h("option", { value: k, selected: k === CAR.preset }, l)));
  preset.addEventListener("change", () => { CAR.preset = preset.value; CAR.picks = presetPicks(); CAR.slides = null; renderCarousel(); });
  const title = h("input", { id: "c-title", maxlength: "60", value: CAR.title });
  title.addEventListener("input", () => { CAR.title = title.value; });
  const count = h("span", { class: "status" });
  const setCount = () => { count.textContent = `${CAR.picks.length} plan${CAR.picks.length > 1 ? "s" : ""} choisi${CAR.picks.length > 1 ? "s" : ""} · 9 maximum`; };
  const picked = CAR.picks.map(byId).filter(Boolean);
  CAR.picks = picked.map(p => p.id);
  const list = picked.concat(PRESETS[CAR.preset][1]().filter(p => !CAR.picks.includes(p.id)).slice(0, 40));
  const rows = list.map(p => h("label", { class: "check-row" },
    h("input", { type: "checkbox", checked: CAR.picks.includes(p.id), onchange: e => {
      if (e.target.checked) {
        if (CAR.picks.length >= 9) { e.target.checked = false; toast("9 plans maximum par carrousel."); return; }
        CAR.picks.push(p.id);
      } else CAR.picks = CAR.picks.filter(i => i !== p.id);
      setCount();
    } }),
    h("span", null, h("strong", null, p.name), h("br"), h("small", { style: "color:var(--muted)" }, catLabel(p) + (p.arr ? " · " + arrLabel(p.arr) : ""))),
    h("span", { class: "stars-mini" }, fmtPrice(p.price))));
  setCount();
  const gen = h("button", { type: "button", class: "btn btn-ink", onclick: async () => {
    const plans = CAR.picks.map(byId).filter(Boolean);
    if (!plans.length) { toast("Choisis au moins un plan."); return; }
    if (CAR.busy) return;
    CAR.busy = true; gen.disabled = true; gen.textContent = "Création des slides…";
    try {
      await loadCardFonts();
      CAR.plans = plans; CAR.slides = [drawCover(plans.length), ...plans.map((p, i) => drawPlanSlide(p, i + 1, plans.length)), drawEndSlide()];
      CAR.plans = plans;
    } finally { CAR.busy = false; }
    renderCarousel();
    const out = $("carOut"); if (out) out.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
  } }, CAR.slides ? "Recréer les slides" : "Créer les slides");
  const parts = [head,
    h("div", { class: "form" },
      h("div", { class: "field" }, h("label", { for: "c-preset" }, "Partir d'une sélection"), preset),
      h("div", { class: "field" }, h("label", { for: "c-title" }, "Titre de la couverture"), title),
      h("div", { class: "field" }, h("span", { class: "lbl" }, "Plans du carrousel"), count, h("div", { class: "car-list" }, rows.length ? rows : h("p", { class: "status" }, "Aucun plan dans cette sélection."))),
      gen)];
  if (CAR.slides) {
    const slug = new Date().toISOString().slice(0, 10);
    const caption = carCaption(CAR.plans);
    parts.push(h("div", { class: "box", id: "carOut" },
      h("span", { class: "box-label" }, `Tes ${CAR.slides.length} slides`),
      h("div", { class: "car-grid" }, CAR.slides.map((c, i) => h("figure", null,
        h("img", { src: c.toDataURL("image/png"), alt: "Slide " + (i + 1) }),
        h("button", { type: "button", class: "btn btn-small", onclick: async () => saveFile(`dixballes-${slug}-${String(i + 1).padStart(2, "0")}.png`, await toBlob(c)) }, "Enregistrer")))),
      h("div", { class: "links" },
        h("button", { type: "button", class: "btn btn-ink", onclick: async e => {
          if (!window.JSZip) { toast("Le .zip n'est pas disponible. Enregistre les images une par une."); return; }
          const b = e.currentTarget; b.disabled = true;
          try {
            const zip = new JSZip();
            for (let i = 0; i < CAR.slides.length; i++) zip.file(`${String(i + 1).padStart(2, "0")}-dixballes.png`, await toBlob(CAR.slides[i]));
            await saveFile(`dixballes-carrousel-${slug}.zip`, await zip.generateAsync({ type: "blob" }));
          } finally { b.disabled = false; }
        } }, "Tout enregistrer (.zip)"),
        isTouch() && navigator.canShare ? h("button", { type: "button", class: "btn", onclick: async () => {
          const files = []; for (let i = 0; i < CAR.slides.length; i++) files.push(new File([await toBlob(CAR.slides[i])], `${String(i + 1).padStart(2, "0")}-dixballes.png`, { type: "image/png" }));
          if (!(await shareFiles(files))) toast("Le partage n'est pas disponible : enregistre les images une par une.");
        } }, "Partager les images") : null,
        h("button", { type: "button", class: "btn", onclick: async () => {
          try { await navigator.clipboard.writeText(caption); toast("Légende copiée."); } catch (_) { toast("Sélectionne la légende pour la copier."); }
        } }, "Copier la légende")),
      h("span", { style: "white-space:pre-line;user-select:text;font-size:14px" }, caption)));
  }
  sheet.replaceChildren(...parts);
}
async function loadCardFonts() {
  try { await Promise.all(['900 140px "Big Shoulders Display"', '700 48px "Atkinson Hyperlegible"', '400 48px "Atkinson Hyperlegible"'].map(f => document.fonts.load(f))); } catch (_) {}
}
const CARD = {
  W: 1080, H: 1350, M: 80, INK: "#131A2B", YEL: "#FFCB1F", WHITE: "#FFFFFF", SOFT: "#C5CDDB", GREEN: "#4CC883",
  D: '"Big Shoulders Display", "Arial Narrow", Impact, sans-serif', B: '"Atkinson Hyperlegible", "Segoe UI", Arial, sans-serif',
  CAT: { food: "#FF7A52", culture: "#6FA2EE", vue: "#B48CF2", balade: "#4CC883", soiree: "#F06AAE", cine: "#4FC3BC", autre: "#9AA5B9" }
};
function cardCanvas(bg) {
  const c = document.createElement("canvas"); c.width = CARD.W; c.height = CARD.H;
  const x = c.getContext("2d"); x.fillStyle = bg; x.fillRect(0, 0, CARD.W, CARD.H);
  x.textAlign = "left"; x.textBaseline = "alphabetic";
  return [c, x];
}
function cardBrand(x, X, Y, onYellow) {
  x.save(); x.translate(X + 46, Y - 18); x.rotate(-12 * Math.PI / 180);
  x.fillStyle = onYellow ? CARD.INK : CARD.YEL; x.beginPath(); x.arc(0, 0, 46, 0, Math.PI * 2); x.fill();
  x.fillStyle = onYellow ? CARD.YEL : CARD.INK; x.textAlign = "center"; x.textBaseline = "middle"; x.font = `900 17px ${CARD.D}`; x.fillText("MAX", 0, -14); x.font = `900 28px ${CARD.D}`; x.fillText("10€", 0, 8);
  x.restore();
  x.fillStyle = onYellow ? CARD.INK : CARD.WHITE; x.font = `900 56px ${CARD.D}`; x.fillText("DIX BALLES", X + 112, Y);
}
function drawCover(n) {
  const { W, H, M, INK, D, B } = CARD;
  const [c, x] = cardCanvas(CARD.YEL);
  cardBrand(x, M, 150, true);
  let size = 170, lines;
  do { x.font = `900 ${size}px ${D}`; lines = wrapText(x, (CAR.title || "Les bons plans de la semaine").toUpperCase(), W - 2 * M); size -= 8; }
  while ((lines.length > 3 || lines.some(l => x.measureText(l).width > W - 2 * M)) && size > 70);
  size += 8; x.fillStyle = INK;
  let y = 330;
  for (const l of lines) { y += size * 0.9; x.fillText(l, M, y); }
  const place = carPlace(); y += 110; fitFont(x, weekLabel() + " · " + place, 700, 48, B, W - 2 * M, 28); x.fillText(weekLabel() + " · " + place, M, y);
  const tag = `${n} adresse${n > 1 ? "s" : ""} · rien au-dessus de 10 €`;
  const tw = Math.min(W - 2 * M, (fitFont(x, tag, 700, 44, B, W - 2 * M - 80, 26), x.measureText(tag).width + 80));
  x.fillStyle = INK; x.beginPath(); x.roundRect(M, H - 260, tw, 100, 50); x.fill();
  x.fillStyle = CARD.WHITE; x.textBaseline = "middle"; x.fillText(tag, M + 40, H - 210); x.textBaseline = "alphabetic";
  x.fillStyle = INK; x.font = `700 40px ${B}`; x.textAlign = "right"; x.fillText("Fais glisser →", W - M, H - 80); x.textAlign = "left";
  return c;
}
function drawPlanSlide(p, i, n) {
  const { W, H, M, INK, YEL, WHITE, SOFT, D, B } = CARD;
  const [c, x] = cardCanvas(INK);
  x.fillStyle = WHITE; x.font = `900 44px ${D}`; x.fillText("DIX BALLES", M, 110);
  x.fillStyle = SOFT; x.font = `700 40px ${B}`; x.textAlign = "right"; x.fillText(`${i} / ${n}`, W - M, 110); x.textAlign = "left";
  let y = 230;
  x.fillStyle = CARD.CAT[p.cat] || CARD.CAT.autre; x.beginPath(); x.arc(M + 13, y - 13, 13, 0, Math.PI * 2); x.fill();
  const catLine = (catLabel(p) + " · " + (p.arr && cityKey(p.city) === "paris" ? "Paris " + arrLabel(p.arr) : prettyCity(p.city))).toUpperCase();
  x.fillStyle = WHITE; fitFont(x, catLine, 700, 36, B, W - 2 * M - 40, 22); x.fillText(catLine, M + 40, y);
  let size = 130, lines;
  do { x.font = `900 ${size}px ${D}`; lines = wrapText(x, p.name.toUpperCase(), W - 2 * M); size -= 8; }
  while ((lines.length > 3 || lines.some(l => x.measureText(l).width > W - 2 * M)) && size > 60);
  size += 8; y += 30;
  for (const l of lines) { y += size * 0.92; x.fillText(l, M, y); }
  y += 75;
  const label = fmtPrice(p.price).toUpperCase();
  x.font = `900 110px ${D}`;
  const tw = x.measureText(label).width + 70, th = 145;
  x.save(); x.translate(M + tw / 2, y + th / 2); x.rotate(-4 * Math.PI / 180);
  x.fillStyle = YEL; x.beginPath(); x.roundRect(-tw / 2, -th / 2, tw, th, 20); x.fill();
  x.lineWidth = 5; x.strokeStyle = WHITE; x.stroke();
  x.fillStyle = INK; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(label, 0, 6);
  x.restore(); x.textAlign = "left"; x.textBaseline = "alphabetic";
  if (p.cat === "food" && p.veg) {
    const vt = p.veg === "full" ? "100 % VÉGÉ" : "OPTION VÉGÉ";
    x.font = `700 34px ${B}`; const vw = x.measureText(vt).width + 48;
    x.strokeStyle = CARD.GREEN; x.lineWidth = 4; x.beginPath(); x.roundRect(M + tw + 40, y + 45, vw, 64, 32); x.stroke();
    x.fillStyle = CARD.GREEN; x.textBaseline = "middle"; x.fillText(vt, M + tw + 64, y + 79); x.textBaseline = "alphabetic";
  }
  y += th + 95;
  x.fillStyle = WHITE; x.font = `400 46px ${B}`;
  for (const l of wrapText(x, p.deal, W - 2 * M).slice(0, 5)) { x.fillText(l, M, y); y += 62; }
  if (p.address) { y += 14; x.fillStyle = SOFT; x.font = `700 36px ${B}`; for (const l of wrapText(x, p.address, W - 2 * M).slice(0, 2)) { x.fillText(l, M, y); y += 48; } }
  x.fillStyle = YEL; x.fillRect(0, H - 120, W, 120);
  x.fillStyle = INK; const foot = "Enregistre ce post · " + INSTAGRAM; fitFont(x, foot, 700, 40, B, W - 2 * M, 24); x.fillText(foot, M, H - 48);
  return c;
}
function drawEndSlide() {
  const { W, H, M, INK, YEL, WHITE, SOFT, D, B } = CARD;
  const [c, x] = cardCanvas(INK);
  let y = 330, size = 150, lines;
  do { x.font = `900 ${size}px ${D}`; lines = wrapText(x, "ENREGISTRE CE POST", W - 2 * M); size -= 8; }
  while (lines.some(l => x.measureText(l).width > W - 2 * M) && size > 60);
  size += 8; x.fillStyle = YEL;
  for (const l of lines) { y += size * 0.9; x.fillText(l, M, y); }
  y += 90; x.fillStyle = WHITE; x.font = `400 50px ${B}`;
  for (const l of wrapText(x, "pour ressortir les adresses au bon moment, et envoie-le à ton pote fauché.", W - 2 * M)) { x.fillText(l, M, y); y += 68; }
  y += 60; x.font = `700 46px ${B}`;
  for (const l of wrapText(x, "Toutes les adresses à 10 € max sur " + INSTAGRAM, W - 2 * M)) { x.fillText(l, M, y); y += 62; }
  y += 30; x.fillStyle = SOFT; x.font = `400 40px ${B}`;
  for (const l of wrapText(x, "Un bon plan dans ta ville ? Ajoute-le sur le site ou écris-nous en DM.", W - 2 * M)) { x.fillText(l, M, y); y += 54; }
  cardBrand(x, M, H - 100, false);
  return c;
}

/* ---------- Démarrage ---------- */
$("footHandle").textContent = INSTAGRAM;
$("footHandle").href = INSTAGRAM_URL;
S.sb = initSupabase();
renderAll();
(async () => {
  if (S.sb) {
    S.sb.auth.onAuthStateChange(() => { setTimeout(checkTeam, 0); });
    await checkTeam();
  }
  await loadData();
})();
