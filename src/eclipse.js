/**
 * Eclipse geometry from Besselian elements.
 *
 * Everything here is framework-free so it can run in Node (see scripts/check-elements.mjs)
 * and in the browser. Units: Earth equatorial radii (ER) for lengths, hours for time,
 * radians for angles unless a name ends in `Deg`.
 *
 * Coordinate frames
 *  - Earth-fixed (EF): X toward the Greenwich meridian on the equator, Y toward 90°E, Z north.
 *  - Fundamental (Besselian): ξ east, η north, ζ toward the Moon/Sun; the ξ–η plane passes
 *    through Earth's centre and is perpendicular to the shadow axis.
 *
 * References
 *  - Fred Espenak, NASA/GSFC, Besselian elements for 2027 Aug 02
 *    https://eclipse.gsfc.nasa.gov/SEbeselm/SEbeselm2001/SE2027Aug02Tbeselm.html
 *  - J. Meeus, "Elements of Solar Eclipses 1951–2200" (method for surface intersection).
 */

const DEG = Math.PI / 180;
export const EARTH_RADIUS_KM = 6378.137;
export const FLATTENING = 1 / 298.257;
export const E2 = 2 * FLATTENING - FLATTENING * FLATTENING; // first eccentricity squared
export const OMF2 = (1 - FLATTENING) ** 2; // (1 - f)^2

/** NASA/GSFC Besselian elements, polynomial in t = TDT hours − t0. */
export const ECLIPSE = {
  title: 'Total Solar Eclipse',
  isoDate: '2027-08-02',
  dateUTC: Date.UTC(2027, 7, 2), // 0h UT on the eclipse day
  t0: 10.0, // TDT hours
  deltaT: 71.7, // s, TDT − UT
  x: [-0.019645, 0.5447105, -0.0000444, -0.0000091],
  y: [0.160063, -0.2111569, -0.0001217, 0.0000037],
  d: [17.76247, -0.010181, -0.000004], // degrees
  l1: [0.530596, 0.0000138, -0.0000128],
  l2: [-0.015464, 0.0000137, -0.0000128],
  mu: [328.42249, 15.002093], // degrees
  tanF1: 0.0046064,
  tanF2: 0.0045834,
  k1: 0.272488, // lunar radius used for the penumbra (ER)
  k2: 0.272281, // lunar radius used for the umbra (ER)
  gamma: 0.1421,
  magnitude: 1.079,
  saros: '136 (38/71)',
  validRange: [-3, 3], // hours from t0 for which the polynomials are valid
  source: 'Fred Espenak, NASA/GSFC (VSOP87/ELP2000-85)',
};

function poly(c, t) {
  let v = 0;
  for (let i = c.length - 1; i >= 0; i--) v = v * t + c[i];
  return v;
}
function dpoly(c, t) {
  let v = 0;
  for (let i = c.length - 1; i >= 1; i--) v = v * t + i * c[i];
  return v;
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Ellipsoid metric: g(v, w) = 1 on the surface X² + Y² + Z²/(1−f)² = 1. */
const g = (a, b) => a[0] * b[0] + a[1] * b[1] + (a[2] * b[2]) / OMF2;

/** Time conversions. t is hours from t0 in TDT. */
export function tToDate(t) {
  return new Date(ECLIPSE.dateUTC + (ECLIPSE.t0 + t) * 3600e3 - ECLIPSE.deltaT * 1e3);
}
export function utHoursToT(utHours) {
  return utHours + ECLIPSE.deltaT / 3600 - ECLIPSE.t0;
}

/** Evaluate all elements and the fundamental-frame basis (in EF coordinates) at t. */
export function elementsAt(t) {
  const E = ECLIPSE;
  const d = poly(E.d, t) * DEG;
  // μ is measured from the ephemeris meridian; shift it to the Greenwich meridian using ΔT.
  const mu = (poly(E.mu, t) - 0.00417807 * E.deltaT) * DEG;
  const sd = Math.sin(d), cd = Math.cos(d), sm = Math.sin(mu), cm = Math.cos(mu);
  return {
    t,
    x: poly(E.x, t),
    y: poly(E.y, t),
    dx: dpoly(E.x, t),
    dy: dpoly(E.y, t),
    d,
    mu,
    muRate: dpoly(E.mu, t) * DEG, // rad/h, Earth rotation rate as seen by the frame
    l1: poly(E.l1, t),
    l2: poly(E.l2, t),
    tanF1: E.tanF1,
    tanF2: E.tanF2,
    xi: [sm, cm, 0],
    eta: [-sd * cm, sd * sm, cd],
    zeta: [cd * cm, -cd * sm, sd],
  };
}

/** Intersection of the line (ξ, η, ζ free) with the ellipsoid, nearest the Moon. */
export function surfacePoint(el, xi, eta) {
  const a = [
    xi * el.xi[0] + eta * el.eta[0],
    xi * el.xi[1] + eta * el.eta[1],
    xi * el.xi[2] + eta * el.eta[2],
  ];
  const c = el.zeta;
  const gcc = g(c, c), gac = g(a, c), gaa = g(a, a) - 1;
  const disc = gac * gac - gcc * gaa;
  if (disc < 0) return null;
  const zeta = (-gac + Math.sqrt(disc)) / gcc;
  return { P: [a[0] + zeta * c[0], a[1] + zeta * c[1], a[2] + zeta * c[2]], zeta, xi, eta };
}

/** Point on the limb (ζ = 0) in the direction of (ξ, η). Used when a line misses Earth. */
export function limbPoint(el, xi, eta) {
  const a = [
    xi * el.xi[0] + eta * el.eta[0],
    xi * el.xi[1] + eta * el.eta[1],
    xi * el.xi[2] + eta * el.eta[2],
  ];
  const s = 1 / Math.sqrt(g(a, a));
  return { P: [a[0] * s, a[1] * s, a[2] * s], zeta: 0, xi: xi * s, eta: eta * s, onLimb: true };
}

/** Geodetic latitude/longitude (radians) of an EF point on the ellipsoid. */
export function toLatLon(P) {
  return {
    lat: Math.atan2(P[2], OMF2 * Math.hypot(P[0], P[1])),
    lon: Math.atan2(P[1], P[0]),
  };
}

/** EF position (ER) of a point on the ellipsoid at geodetic lat/lon (degrees). */
export function observerPosition(latDeg, lonDeg) {
  const lat = latDeg * DEG, lon = lonDeg * DEG;
  const s = Math.sin(lat), c = Math.cos(lat);
  const N = 1 / Math.sqrt(1 - E2 * s * s);
  return [N * c * Math.cos(lon), N * c * Math.sin(lon), N * OMF2 * s];
}

/** Outward geodetic normal at lat/lon (degrees). */
export function geodeticNormal(latDeg, lonDeg) {
  const lat = latDeg * DEG, lon = lonDeg * DEG;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

/** Fundamental-frame coordinates of an EF point. */
export function toFundamental(el, P) {
  return { xi: dot(P, el.xi), eta: dot(P, el.eta), zeta: dot(P, el.zeta) };
}

/** Great-circle distance (km) between two EF unit-ish vectors. */
export function distanceKm(P, Q) {
  const a = normalize(P), b = normalize(Q);
  const c = Math.min(1, Math.max(-1, dot(a, b)));
  return Math.acos(c) * 6371.0;
}
function normalize(v) {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}

/**
 * Fraction of the Sun's disc covered, given the eclipse magnitude m and the ratio ρ of the
 * apparent radii Moon/Sun. Sun radius = 1, Moon radius = ρ, centre separation s = 1 + ρ − 2m.
 */
export function obscuration(m, rho) {
  if (m <= 0) return 0;
  const s = 1 + rho - 2 * m;
  if (s <= Math.abs(1 - rho)) return rho >= 1 ? 1 : rho * rho;
  if (s >= 1 + rho) return 0;
  const a1 = Math.acos(Math.min(1, Math.max(-1, (s * s + rho * rho - 1) / (2 * s * rho))));
  const a2 = Math.acos(Math.min(1, Math.max(-1, (s * s + 1 - rho * rho) / (2 * s))));
  const k = (-s + 1 + rho) * (s + 1 - rho) * (s - 1 + rho) * (s + 1 + rho);
  const area = rho * rho * a1 + a2 - 0.5 * Math.sqrt(Math.max(0, k));
  return area / Math.PI;
}

/** Ground velocity (ER/h) of an EF point due to Earth's rotation, in fundamental coords. */
function groundVelocity(el, P) {
  const v = [-P[1] * el.muRate, P[0] * el.muRate, 0]; // ω ẑ × P
  return { vxi: dot(v, el.xi), veta: dot(v, el.eta) };
}

/**
 * Umbra at time t: centre, radius, the direction of travel over the ground and the two
 * lateral limit points (northern and southern edge of the path).
 */
export function umbraAt(t) {
  const el = elementsAt(t);
  const centre = surfacePoint(el, el.x, el.y);
  const zetaC = centre ? centre.zeta : 0;
  const radius = Math.abs(el.l2 - zetaC * el.tanF2);
  // Direction of travel relative to the ground (fundamental plane), used for the sweep envelope.
  const P = centre ? centre.P : limbPoint(el, el.x, el.y).P;
  const { vxi, veta } = groundVelocity(el, P);
  const qDir = Math.atan2(el.dx - vxi, el.dy - veta); // Q measured from η toward ξ
  const limit = (q) => {
    let L = radius;
    let pt = null;
    for (let i = 0; i < 4; i++) {
      const xi = el.x + L * Math.sin(q), eta = el.y + L * Math.cos(q);
      pt = surfacePoint(el, xi, eta);
      if (!pt) { pt = limbPoint(el, xi, eta); break; }
      L = Math.abs(el.l2 - pt.zeta * el.tanF2);
    }
    return pt;
  };
  const north = limit(qDir - Math.PI / 2);
  const south = limit(qDir + Math.PI / 2);
  return { t, el, centre, radius, north, south, qDir };
}

/** Closed outline (n points) of the umbra (which = 'umbra') or penumbra on the surface. */
export function shadowOutline(t, which = 'umbra', n = 90) {
  const el = elementsAt(t);
  const l = which === 'umbra' ? el.l2 : el.l1;
  const tanF = which === 'umbra' ? el.tanF2 : el.tanF1;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const q = (i / n) * 2 * Math.PI;
    let L = Math.abs(l);
    let pt = null;
    for (let k = 0; k < 4; k++) {
      const xi = el.x + L * Math.sin(q), eta = el.y + L * Math.cos(q);
      pt = surfacePoint(el, xi, eta);
      if (!pt) { pt = limbPoint(el, xi, eta); break; }
      L = Math.abs(l - pt.zeta * tanF);
    }
    pts.push(pt);
  }
  return pts;
}

/** True when any part of the shadow (at ζ≈0 radius) touches the ellipsoid. */
function shadowTouches(t, which) {
  const el = elementsAt(t);
  const L = Math.abs(which === 'umbra' ? el.l2 : el.l1);
  const n = 720;
  for (let i = 0; i < n; i++) {
    const q = (i / n) * 2 * Math.PI;
    if (surfacePoint(el, el.x + L * Math.sin(q), el.y + L * Math.cos(q))) return true;
  }
  return false;
}

function bisect(fn, a, b, iters = 40) {
  // fn(a) !== fn(b); returns the boundary where fn flips.
  let fa = fn(a);
  for (let i = 0; i < iters; i++) {
    const m = 0.5 * (a + b);
    if (fn(m) === fa) a = m; else b = m;
  }
  return 0.5 * (a + b);
}

/** Global contact times (t hours from t0): P1, U1, greatest eclipse, U4, P4. */
export function contacts() {
  const [lo, hi] = ECLIPSE.validRange;
  const step = 1 / 60;
  const find = (which) => {
    let first = null, last = null;
    for (let t = lo; t <= hi; t += step) {
      if (shadowTouches(t, which)) { if (first === null) first = t; last = t; }
    }
    if (first === null) return [null, null];
    const f = (t) => shadowTouches(t, which);
    return [bisect(f, first - step, first), bisect(f, last, last + step)];
  };
  const [p1, p4] = find('penumbra');
  const [u1, u4] = find('umbra');
  // Greatest eclipse: minimum distance of the shadow axis from Earth's centre.
  let ge = 0, best = Infinity;
  for (let t = lo; t <= hi; t += 1 / 3600) {
    const el = elementsAt(t);
    const r = Math.hypot(el.x, el.y);
    if (r < best) { best = r; ge = t; }
  }
  return { p1, u1, ge, u4, p4, gamma: best };
}

/**
 * Local circumstances at a site. Returns contact times (t hours), max magnitude,
 * obscuration, totality duration (s) and whether the Sun is up at maximum.
 */
export function localCircumstances(latDeg, lonDeg, range = ECLIPSE.validRange) {
  const P = observerPosition(latDeg, lonDeg);
  const n = geodeticNormal(latDeg, lonDeg);
  const state = (t) => {
    const el = elementsAt(t);
    const f = toFundamental(el, P);
    const delta = Math.hypot(f.xi - el.x, f.eta - el.y);
    const L1 = el.l1 - f.zeta * el.tanF1;
    const L2 = el.l2 - f.zeta * el.tanF2;
    return {
      m: (L1 - delta) / (L1 + L2),
      rho: (L1 - L2) / (L1 + L2),
      partial: delta < L1,
      total: L2 < 0 && delta < -L2,
      sunUp: dot(n, el.zeta) > 0,
      sunAlt: Math.asin(Math.max(-1, Math.min(1, dot(n, el.zeta)))),
    };
  };
  const step = 10 / 3600;
  let c1 = null, c4 = null, c2 = null, c3 = null, tMax = null, mMax = -Infinity;
  for (let t = range[0]; t <= range[1]; t += step) {
    const s = state(t);
    if (s.partial && s.sunUp) {
      if (c1 === null) c1 = t;
      c4 = t;
      if (s.m > mMax) { mMax = s.m; tMax = t; }
    }
    if (s.total && s.sunUp) {
      if (c2 === null) c2 = t;
      c3 = t;
    }
  }
  if (c1 === null) return { visible: false, magnitude: 0, obscuration: 0 };
  const partial = (t) => { const s = state(t); return s.partial && s.sunUp; };
  const total = (t) => { const s = state(t); return s.total && s.sunUp; };
  c1 = bisect(partial, c1 - step, c1);
  c4 = bisect(partial, c4, c4 + step);
  if (c2 !== null) {
    c2 = bisect(total, c2 - step, c2);
    c3 = bisect(total, c3, c3 + step);
  }
  // Refine the maximum with a golden-section search around the best sample.
  let a = tMax - step, b = tMax + step;
  const phi = (Math.sqrt(5) - 1) / 2;
  let x1 = b - phi * (b - a), x2 = a + phi * (b - a);
  let f1 = state(x1).m, f2 = state(x2).m;
  for (let i = 0; i < 40; i++) {
    if (f1 < f2) { a = x1; x1 = x2; f1 = f2; x2 = a + phi * (b - a); f2 = state(x2).m; }
    else { b = x2; x2 = x1; f2 = f1; x1 = b - phi * (b - a); f1 = state(x1).m; }
  }
  tMax = 0.5 * (a + b);
  const sMax = state(tMax);
  return {
    visible: true,
    c1, c2, c3, c4, tMax,
    magnitude: sMax.m,
    obscuration: obscuration(sMax.m, sMax.rho),
    totalDuration: c2 !== null ? (c3 - c2) * 3600 : null,
    sunAltDeg: sMax.sunAlt / DEG,
  };
}

/** Duration (s) of totality at the umbra centre at time t; null when the centre is off Earth. */
export function centralDuration(t) {
  const el = elementsAt(t);
  const centre = surfacePoint(el, el.x, el.y);
  if (!centre) return null;
  const P = centre.P;
  const inside = (tau) => {
    const e = elementsAt(tau);
    const f = toFundamental(e, P);
    const delta = Math.hypot(f.xi - e.x, f.eta - e.y);
    return delta < Math.abs(e.l2 - f.zeta * e.tanF2);
  };
  const w = 0.15; // h, comfortably larger than half of any totality
  const t2 = bisect(inside, t - w, t, 30);
  const t3 = bisect(inside, t, t + w, 30);
  return (t3 - t2) * 3600;
}

/** Height of the Moon's centre above the fundamental plane (ER), from the penumbral cone. */
export function moonHeight(el) {
  const sinF1 = el.tanF1 / Math.sqrt(1 + el.tanF1 * el.tanF1);
  return el.l1 / el.tanF1 - ECLIPSE.k1 / sinF1;
}

export function formatLat(rad) {
  const v = rad / DEG;
  return `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'N' : 'S'}`;
}
export function formatLon(rad) {
  let v = rad / DEG;
  if (v > 180) v -= 360;
  if (v < -180) v += 360;
  return `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'E' : 'W'}`;
}
export function formatDuration(s) {
  if (s == null) return '—';
  const m = Math.floor(s / 60);
  return `${m}m ${(s - m * 60).toFixed(1).padStart(4, '0')}s`;
}
export function formatUT(t, withSeconds = true) {
  const d = tToDate(t);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return withSeconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
}
