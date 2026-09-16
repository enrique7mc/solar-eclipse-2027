import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import {
  ECLIPSE, elementsAt, contacts, umbraAt, surfacePoint, limbPoint, toLatLon, geodeticNormal,
  localCircumstances, centralDuration, moonHeight, distanceKm,
  formatUT, formatLat, formatLon, formatDuration, utHoursToT,
} from './eclipse.js';
import { createEarth } from './earth.js';
import { CITIES } from './cities.js';

const $ = (id) => document.getElementById(id);

// ---------- coordinate helpers ----------
/** Earth-fixed [X, Y, Z] (Z north, Y 90°E) -> three.js Vector3 (y up, texture seam at -x). */
const ef = (v) => new THREE.Vector3(v[0], v[2], -v[1]);
/** Ellipsoid point -> unit-sphere direction through its geodetic lat/lon (matches the texture). */
function efToSphere(P) {
  const { lat, lon } = toLatLon(P);
  return ef([Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]);
}
const latLonDir = (lat, lon) => ef(geodeticNormal(lat, lon));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- renderer / scene ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x05070d, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 4000);
camera.position.set(0, 0, 3);

const labelRenderer = new CSS2DRenderer({ element: $('labels') });

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.08;
controls.maxDistance = 400;
controls.zoomSpeed = 0.8;
controls.rotateSpeed = 0.6;
controls.enablePan = false;

// ---------- eclipse timeline ----------
const C = contacts();
const T_START = C.p1 - 6 / 60;
const T_END = C.p4 + 6 / 60;
const state = {
  t: C.ge,
  playing: false,
  speed: 600,
  follow: true,
  dragging: false,
  flight: null,
  activeCity: null,
  viewMode: 'globe',
};

// ---------- stars ----------
{
  const n = 5000;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(1500);
    pos.set([v.x, v.y, v.z], i * 3);
    const w = 0.5 + Math.random() * 0.5;
    const tint = Math.random();
    col.set([w * (0.85 + 0.15 * tint), w * (0.85 + 0.1 * tint), w * (0.9 + 0.1 * (1 - tint))], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false })));
}

// ---------- Sun glow (direction only) ----------
function radialSprite(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.25, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialSprite('rgba(255,250,230,1)', 'rgba(255,200,120,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
sunSprite.scale.setScalar(90);
scene.add(sunSprite);

// ---------- lights (for the Moon only; Earth has its own shader) ----------
const sunLight = new THREE.DirectionalLight(0xffffff, 3.0);
scene.add(sunLight, sunLight.target, new THREE.AmbientLight(0xffffff, 0.08));

// ---------- Moon, shadow cones, axis ----------
const shadowGroup = new THREE.Group(); // fundamental frame -> world
shadowGroup.matrixAutoUpdate = false;
const axisGroup = new THREE.Group(); // translated to (x, y) on the fundamental plane
shadowGroup.add(axisGroup);
scene.add(shadowGroup);

const el0 = elementsAt(0);
const hMoon = moonHeight(el0);
const moon = new THREE.Mesh(
  new THREE.SphereGeometry(ECLIPSE.k2, 64, 48),
  new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 1, metalness: 0 }),
);
moon.position.set(0, 0, hMoon);
axisGroup.add(moon);
// Soft halo so the Moon stays findable in the true-scale Earth–Moon view.
const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialSprite('rgba(220,228,255,0.55)', 'rgba(220,228,255,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 }));
moonHalo.scale.setScalar(3.2);
moon.add(moonHalo);
const moonLabel = new CSS2DObject(Object.assign(document.createElement('div'), { className: 'label label--moon', textContent: 'Moon' }));
moonLabel.position.set(ECLIPSE.k2, 0, 0);
moon.add(moonLabel);
const earthLabel = new CSS2DObject(Object.assign(document.createElement('div'), { className: 'label label--earth', textContent: 'Earth' }));
earthLabel.visible = false;
scene.add(earthLabel);

function cone(rTop, rBottom, zTop, zBottom, material) {
  const h = zTop - zBottom;
  const geo = new THREE.CylinderGeometry(rTop, rBottom, h, 96, 1, true);
  geo.rotateX(Math.PI / 2); // +y -> +z
  geo.translate(0, 0, zBottom + h / 2);
  return new THREE.Mesh(geo, material);
}
const zVertex = el0.l2 / el0.tanF2; // umbral cone tip (ζ), beyond Earth for a total eclipse
const penumbraCone = cone(
  ECLIPSE.k1, el0.l1 + 2.0 * el0.tanF1, hMoon, -2.0,
  new THREE.MeshBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0.045, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
);
const umbraCone = cone(
  ECLIPSE.k2, 0.0005, hMoon, zVertex,
  new THREE.MeshBasicMaterial({ color: 0xff6a2a, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
);
const axisLine = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, hMoon), new THREE.Vector3(0, 0, 0.9)]),
  new THREE.LineDashedMaterial({ color: 0xffb347, dashSize: 0.4, gapSize: 0.25, transparent: true, opacity: 0.7 }),
);
axisLine.computeLineDistances();
axisGroup.add(penumbraCone, umbraCone, axisLine);
const conesVisible = (v) => { penumbraCone.visible = umbraCone.visible = axisLine.visible = moon.visible = v; moonLabel.visible = v; };
conesVisible(false);

// ---------- Earth ----------
let earth = null;
const loader = new THREE.TextureLoader();
async function loadTexture(url) {
  const tex = await loader.loadAsync(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// ---------- path of totality ----------
const pathGroup = new THREE.Group();
scene.add(pathGroup);
const lineMaterial = new LineMaterial({ color: 0xffb347, linewidth: 2, transparent: true, opacity: 0.95, depthWrite: false });
function buildPath() {
  const north = [], south = [], centre = [];
  const step = 20 / 3600;
  for (let tau = C.u1; tau <= C.u4 + 1e-9; tau += step) {
    const u = umbraAt(tau);
    north.push(efToSphere(u.north.P).multiplyScalar(1.004));
    south.push(efToSphere(u.south.P).multiplyScalar(1.004));
    if (u.centre) centre.push(efToSphere(u.centre.P).multiplyScalar(1.006));
  }
  // Band between the northern and southern limits.
  const n = north.length;
  const pos = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    pos.set([north[i].x, north[i].y, north[i].z], i * 6);
    pos.set([south[i].x, south[i].y, south[i].z], i * 6 + 3);
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const band = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff7a3d, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }));
  pathGroup.add(band);

  const edgeMat = new LineMaterial({ color: 0xff9a5c, linewidth: 1, transparent: true, opacity: 0.55, depthWrite: false });
  for (const pts of [north, south]) {
    const g = new LineGeometry();
    g.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
    pathGroup.add(new Line2(g, edgeMat));
  }
  const cg = new LineGeometry();
  cg.setPositions(centre.flatMap((p) => [p.x, p.y, p.z]));
  pathGroup.add(new Line2(cg, lineMaterial));
  return { edgeMat };
}
const { edgeMat } = buildPath();

// ---------- city markers ----------
const cityData = CITIES.map((c) => ({ ...c, lc: localCircumstances(c.lat, c.lon), dir: latLonDir(c.lat, c.lon) }));
cityData.sort((a, b) => (a.lc.tMax ?? Infinity) - (b.lc.tMax ?? Infinity));
{
  const pos = new Float32Array(cityData.length * 3);
  const col = new Float32Array(cityData.length * 3);
  cityData.forEach((c, i) => {
    const p = c.dir.clone().multiplyScalar(1.004);
    pos.set([p.x, p.y, p.z], i * 3);
    const color = c.lc.totalDuration != null ? new THREE.Color(0xffb347) : new THREE.Color(c.lc.visible ? 0x9aa4b5 : 0x4a5160);
    col.set([color.r, color.g, color.b], i * 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ map: radialSprite('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), size: 9, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, alphaTest: 0.2 });
  scene.add(new THREE.Points(geo, mat));
}
const cityLabels = cityData.map((c) => {
  const div = document.createElement('div');
  div.className = 'label' + (c.lc.totalDuration != null ? ' label--total' : '');
  div.textContent = c.name;
  const obj = new CSS2DObject(div);
  obj.position.copy(c.dir).multiplyScalar(1.004);
  scene.add(obj);
  return obj;
});

// ---------- UI: city list ----------
{
  const list = $('city-list');
  const totalCount = cityData.filter((c) => c.lc.totalDuration != null).length;
  $('city-count').textContent = `· ${totalCount} in the path`;
  cityData.forEach((c, i) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'city';
    btn.type = 'button';
    let status, cls;
    if (c.lc.totalDuration != null) { status = `Total ${formatDuration(c.lc.totalDuration)}`; cls = 'is-total'; }
    else if (c.lc.visible) { const pct = c.lc.obscuration * 100; status = `Partial ${pct >= 99.05 ? Math.min(pct, 99.9).toFixed(1) : pct.toFixed(0)}%`; cls = 'is-partial'; }
    else { status = 'Not visible'; cls = 'is-none'; }
    const time = c.lc.visible ? `<span class="city__time">max ${formatUT(c.lc.tMax, false)} UT</span>` : '';
    btn.innerHTML = `<span class="city__name">${c.name}</span><span class="city__country">${c.country}</span><span class="city__status ${cls}">${status}${time}</span>`;
    btn.addEventListener('click', () => goToCity(i));
    li.appendChild(btn);
    list.appendChild(li);
  });
}
const mobileLayout = window.matchMedia('(max-width: 900px)');
function setCitiesOpen(open) {
  const cities = $('cities');
  cities.classList.toggle('is-open', open);
  cities.classList.toggle('is-collapsed', !open);
  $('cities-toggle').setAttribute('aria-expanded', String(open));
}
setCitiesOpen(!mobileLayout.matches);
$('cities-toggle').addEventListener('click', () => setCitiesOpen(true));
$('cities-close').addEventListener('click', () => setCitiesOpen(false));
mobileLayout.addEventListener('change', (e) => setCitiesOpen(!e.matches));

function goToCity(i) {
  const c = cityData[i];
  document.querySelectorAll('.city').forEach((b, j) => b.classList.toggle('is-active', j === i));
  state.activeCity = i;
  state.playing = false;
  updatePlayButton();
  leaveEarthMoonView();
  setFollow(false);
  if (c.lc.visible) setTime(c.lc.tMax);
  flyTo(c.dir.clone().multiplyScalar(Math.min(controls.getDistance(), 1.45)), new THREE.Vector3(0, 0, 0), 1.2);
  if (mobileLayout.matches) setCitiesOpen(false);
}

// ---------- camera helpers ----------
function flyTo(position, target, duration = 1.2) {
  state.flight = {
    p0: camera.position.clone(), p1: position.clone(),
    t0: controls.target.clone(), t1: target.clone(),
    start: performance.now(), duration: duration * 1000,
  };
}
function stepFlight(now) {
  const f = state.flight;
  if (!f) return;
  const k = clamp((now - f.start) / f.duration, 0, 1);
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  // Interpolate the direction and distance separately so the camera swings around the globe.
  const d0 = f.p0.clone().sub(f.t0), d1 = f.p1.clone().sub(f.t1);
  const len = THREE.MathUtils.lerp(d0.length(), d1.length(), e);
  const q = new THREE.Quaternion().setFromUnitVectors(d0.clone().normalize(), d1.clone().normalize());
  const dir = d0.clone().normalize().applyQuaternion(new THREE.Quaternion().slerp(q, e));
  controls.target.lerpVectors(f.t0, f.t1, e);
  camera.position.copy(controls.target).addScaledVector(dir, len);
  if (k >= 1) state.flight = null;
}

/** Direction (unit, three.js) of the umbra centre, or of the limb point nearest the axis. */
function umbraDir(el) {
  const p = surfacePoint(el, el.x, el.y) || limbPoint(el, el.x, el.y);
  return efToSphere(p.P);
}
function followUmbra(dt, el) {
  if (!state.follow || state.dragging || state.flight) return;
  const target = umbraDir(el);
  const offset = camera.position.clone().sub(controls.target);
  const dist = offset.length();
  const dir = offset.normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(dir, target);
  const k = 1 - Math.exp(-dt * 3.5);
  dir.applyQuaternion(new THREE.Quaternion().slerp(q, k));
  camera.position.copy(controls.target).addScaledVector(dir, dist);
}
function setFollow(v) {
  state.follow = v;
  $('follow').checked = v;
}

function resetView() {
  leaveEarthMoonView();
  setFollow(true);
  const el = elementsAt(state.t);
  flyTo(umbraDir(el).multiplyScalar(2.6), new THREE.Vector3(0, 0, 0), 1.4);
}
function leaveEarthMoonView() {
  if (state.viewMode !== 'moon') return;
  state.viewMode = 'globe';
  document.body.classList.remove('earth-moon-view');
  $('view-moon').setAttribute('aria-pressed', 'false');
  earthLabel.visible = false;
  camera.up.set(0, 1, 0);
  controls.update();
}
function earthMoonPose(el) {
  const axis = ef(el.zeta).normalize();
  const north = ef(el.eta).normalize();
  const side = new THREE.Vector3().crossVectors(axis, north).normalize();
  const moonWorld = ef(el.xi).multiplyScalar(el.x)
    .addScaledVector(ef(el.eta), el.y)
    .addScaledVector(axis, hMoon);
  const mid = moonWorld.clone().multiplyScalar(0.5);
  if (window.innerWidth <= 900 && window.innerHeight > window.innerWidth) {
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const distance = (moonWorld.length() * 0.5) / (Math.tan(verticalFov * 0.5) * 0.60);
    const target = mid.clone().addScaledVector(axis, -distance * 0.06);
    return { position: target.clone().addScaledVector(side, distance), target, up: axis };
  }
  return {
    position: mid.clone().addScaledVector(side, 78).addScaledVector(north, 18),
    target: mid,
    up: new THREE.Vector3(0, 1, 0),
  };
}
function applyEarthMoonPose(pose) {
  camera.up.copy(pose.up);
  camera.position.copy(pose.position);
  controls.target.copy(pose.target);
  controls.update();
}
function earthMoonView() {
  setFollow(false);
  $('cones').checked = true;
  conesVisible(true);
  state.viewMode = 'moon';
  document.body.classList.add('earth-moon-view');
  $('view-moon').setAttribute('aria-pressed', 'true');
  earthLabel.visible = true;
  const el = elementsAt(state.t);
  const pose = earthMoonPose(el);
  camera.up.copy(pose.up);
  controls.update();
  flyTo(pose.position, pose.target, 1.8);
}

// ---------- readout ----------
const statsEl = $('stats');
const phaseEl = $('phase');
function phaseText(t, u) {
  if (t < C.p1) return `Before first contact. The penumbra reaches Earth at ${formatUT(C.p1)} UT.`;
  if (t < C.u1) return `Partial phases only. The umbra touches down at ${formatUT(C.u1)} UT.`;
  if (t <= C.u4) return u.centre ? 'Total eclipse in progress along the central line.' : 'Umbra grazing the limb at sunrise or sunset.';
  if (t <= C.p4) return `Partial phases only. Last contact at ${formatUT(C.p4)} UT.`;
  return 'The eclipse is over.';
}
function perpendicularWidthKm(u) {
  // Width measured perpendicular to the central line, like NASA's path table.
  const n = efToSphere(u.north.P), s = efToSphere(u.south.P);
  const c = u.centre ? efToSphere(u.centre.P) : n.clone().add(s).normalize();
  const next = umbraAt(u.t + 20 / 3600);
  const c2 = next.centre ? efToSphere(next.centre.P) : c;
  const along = c2.clone().sub(c);
  const chord = n.clone().sub(s);
  if (along.lengthSq() < 1e-12) return chord.length() * 6371;
  along.normalize();
  chord.addScaledVector(along, -chord.dot(along));
  return chord.length() * 6371;
}
let lastReadout = -1;
function updateReadout(t) {
  if (Math.abs(t - lastReadout) < 0.5 / 3600 && t !== T_START && t !== T_END) return;
  lastReadout = t;
  const u = umbraAt(t);
  phaseEl.textContent = phaseText(t, u);
  const rows = [];
  const date = new Date(ECLIPSE.dateUTC + (ECLIPSE.t0 + t) * 3600e3 - ECLIPSE.deltaT * 1e3);
  rows.push(['Time', `${date.toISOString().slice(0, 10)} ${formatUT(t)} UT`]);
  if (u.centre && t >= C.u1 && t <= C.u4) {
    const ll = toLatLon(u.centre.P);
    rows.push(['Umbra centre', `${formatLat(ll.lat)} ${formatLon(ll.lon)}`]);
    rows.push(['Path width', `${perpendicularWidthKm(u).toFixed(0)} km`]);
    const dur = centralDuration(t);
    rows.push(['Totality here', formatDuration(dur)]);
    const next = umbraAt(t + 1 / 3600);
    if (next.centre) {
      const v = distanceKm(u.centre.P, next.centre.P) * 3600;
      rows.push(['Ground speed', `${Math.round(v).toLocaleString('en-US')} km/h`]);
    }
    const alt = Math.asin(clamp(u.centre.zeta, -1, 1)) * 180 / Math.PI;
    rows.push(['Sun altitude', `${alt.toFixed(0)}°`]);
  } else {
    const sub = limbPoint(u.el, u.el.x, u.el.y);
    const ll = toLatLon(surfacePoint(u.el, u.el.x, u.el.y)?.P || sub.P);
    rows.push(['Shadow axis', `${formatLat(ll.lat)} ${formatLon(ll.lon)}`]);
    rows.push(['Penumbra radius', `${(u.el.l1 * 6378).toFixed(0)} km`]);
  }
  rows.push(['Gamma / magnitude', `${ECLIPSE.gamma} / ${ECLIPSE.magnitude}`]);
  const extra = new Set(['Ground speed', 'Gamma / magnitude', 'Penumbra radius']);
  statsEl.innerHTML = rows.map(([k, v]) => { const cls = extra.has(k) ? ' class="row--extra"' : ''; return `<dt${cls}>${k}</dt><dd${cls}>${v}</dd>`; }).join('');
}

// ---------- timeline UI ----------
const scrub = $('scrub');
const utEl = $('ut');
const playBtn = $('play');
function tickMarks() {
  const ticks = $('ticks');
  const pct = (t) => ((t - T_START) / (T_END - T_START)) * 100;
  const band = document.createElement('div');
  band.className = 'band';
  band.style.left = `${pct(C.u1)}%`;
  band.style.width = `${pct(C.u4) - pct(C.u1)}%`;
  band.title = 'Umbra on Earth';
  $('scrub').insertAdjacentElement('beforebegin', band);
  for (const [key, label] of [['p1', 'P1'], ['u1', 'U1'], ['ge', 'Greatest'], ['u4', 'U4'], ['p4', 'P4']]) {
    const s = document.createElement('span');
    s.className = 'tick' + (key === 'ge' ? ' tick--ge' : '');
    s.style.left = `${pct(C[key])}%`;
    s.innerHTML = `<span class="tick__name">${label}</span> <span class="tick__time">${formatUT(C[key], false)}</span>`;
    ticks.appendChild(s);
  }
}
tickMarks();

function setTime(t) {
  state.t = clamp(t, T_START, T_END);
  scrub.value = String((state.t - T_START) / (T_END - T_START));
  utEl.textContent = formatUT(state.t);
}
function updatePlayButton() {
  playBtn.textContent = state.playing ? '❚❚' : '▶';
  playBtn.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
}
function togglePlay() {
  if (!state.playing && state.t >= T_END - 1e-6) setTime(T_START);
  state.playing = !state.playing;
  updatePlayButton();
}
playBtn.addEventListener('click', togglePlay);
scrub.addEventListener('input', () => setTime(T_START + Number(scrub.value) * (T_END - T_START)));
$('step-back').addEventListener('click', () => setTime(state.t - 1 / 60));
$('step-forward').addEventListener('click', () => setTime(state.t + 1 / 60));
$('speed').addEventListener('change', (e) => { state.speed = Number(e.target.value); });
$('follow').addEventListener('change', (e) => { state.follow = e.target.checked; });
$('path').addEventListener('change', (e) => { pathGroup.visible = e.target.checked; });
$('cones').addEventListener('change', (e) => {
  conesVisible(e.target.checked);
  if (!e.target.checked && state.viewMode === 'moon') resetView();
});
$('view-moon').addEventListener('click', earthMoonView);
$('view-reset').addEventListener('click', resetView);
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.code === 'ArrowRight') setTime(state.t + (e.shiftKey ? 10 : 1) / 60);
  else if (e.code === 'ArrowLeft') setTime(state.t - (e.shiftKey ? 10 : 1) / 60);
  else if (e.code === 'Escape' && $('cities').classList.contains('is-open')) setCitiesOpen(false);
});
controls.addEventListener('start', () => { state.dragging = true; state.flight = null; });
controls.addEventListener('end', () => { state.dragging = false; });

// ---------- resize ----------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  lineMaterial.resolution.set(w, h);
  edgeMat.resolution.set(w, h);
  if (state.viewMode === 'moon' && !state.flight) applyEarthMoonPose(earthMoonPose(elementsAt(state.t)));
}
window.addEventListener('resize', resize);
resize();

// ---------- per-frame scene update ----------
const camDir = new THREE.Vector3();
function updateScene(el) {
  if (earth) earth.update(el, camera);
  shadowGroup.matrix.makeBasis(ef(el.xi), ef(el.eta), ef(el.zeta));
  axisGroup.position.set(el.x, el.y, 0);
  const sun = ef(el.zeta);
  sunLight.position.copy(sun).multiplyScalar(200);
  sunSprite.position.copy(sun).multiplyScalar(1400);
  updateReadout(el.t);
}
function updateLabels() {
  camDir.copy(camera.position).sub(controls.target).normalize();
  const dist = camera.position.length();
  cityData.forEach((c, i) => {
    const facing = c.dir.dot(camDir) > 0.12;
    const important = i === state.activeCity || (!mobileLayout.matches && c.lc.totalDuration != null);
    cityLabels[i].visible = facing && (important ? dist < 12 : dist < 2.0);
  });
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (state.playing) {
    const t = state.t + (state.speed * dt) / 3600;
    if (t >= T_END) { setTime(T_END); state.playing = false; updatePlayButton(); }
    else setTime(t);
  }
  const el = elementsAt(state.t);
  stepFlight(now);
  followUmbra(dt, el);
  controls.update();
  updateScene(el);
  if (earth) earth.uniforms.uCamPosObj.value.copy(camera.position);
  updateLabels();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- boot ----------
async function boot() {
  setTime(C.ge);
  camera.position.copy(umbraDir(elementsAt(state.t))).multiplyScalar(2.6);
  controls.update();
  requestAnimationFrame(frame);
  try {
    const [day, night] = await Promise.all([loadTexture('/textures/earth_day_4k.jpg'), loadTexture('/textures/earth_night_2k.jpg')]);
    earth = createEarth({ day, night });
    scene.add(earth.mesh);
    $('load-status').textContent = 'NASA Blue Marble / Black Marble';
  } catch (err) {
    console.error(err);
    $('load-status').textContent = 'Texture load failed';
  }
  applyUrlParams();
}

/**
 * Optional URL parameters, e.g. ?t=10:06:37&cones=1&view=moon&paused=1&follow=0
 *  t      UT time as HH:MM[:SS] or decimal hours
 *  paused start paused (default: playing)
 *  follow 0 to disable the follow-umbra camera
 *  cones  1 to show the Moon and its shadow cones
 *  view   moon for the Earth–Moon overview
 *  dist   camera distance from Earth's centre in Earth radii (default 2.6)
 */
function applyUrlParams() {
  const q = new URLSearchParams(location.search);
  let start = C.u1 - 4 / 60; // a little before the umbra touches down
  if (q.has('t')) {
    const v = q.get('t');
    const m = v.match(/^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/);
    const ut = m ? Number(m[1]) + Number(m[2]) / 60 + Number(m[3] || 0) / 3600 : Number(v);
    if (Number.isFinite(ut)) start = utHoursToT(ut);
  }
  setTime(start);
  if (q.get('follow') === '0') setFollow(false);
  if (q.get('cones') === '1') { $('cones').checked = true; conesVisible(true); }
  if (q.get('view') === 'moon') earthMoonView();
  else {
    const dist = clamp(Number(q.get('dist')) || camera.position.length(), controls.minDistance, controls.maxDistance);
    camera.position.copy(umbraDir(elementsAt(state.t))).multiplyScalar(dist);
  }
  state.playing = q.get('paused') !== '1';
  updatePlayButton();
}
boot();
