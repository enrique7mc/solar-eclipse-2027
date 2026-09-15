// Cross-check the eclipse geometry against NASA's published figures for 2027 Aug 02.
// Run: npm run check
import {
  contacts, umbraAt, toLatLon, distanceKm, centralDuration, utHoursToT, formatUT,
  localCircumstances, moonHeight, elementsAt,
} from '../src/eclipse.js';

const DEG = Math.PI / 180;
const dms = (deg, min) => deg + min / 60;
const fmt = (rad, pos, neg) => {
  const v = rad / DEG;
  return `${Math.abs(v).toFixed(3)}${v >= 0 ? pos : neg}`;
};

// NASA path table rows (UT, northern limit, southern limit, central line, width km, duration).
// https://eclipse.gsfc.nasa.gov/SEpath/SEpath2001/SE2027Aug02Tpath.html
const rows = [
  { ut: '08:30', n: [dms(33, 51.7), -dms(27, 4.0)], s: [dms(32, 16.4), -dms(24, 52.3)], c: [dms(33, 5.1), -dms(25, 54.2)], w: 222, dur: 3 * 60 + 51.1 },
  { ut: '09:00', n: [dms(36, 34.8), dms(3, 47.7)], s: [dms(34, 22.6), dms(3, 48.7)], c: [dms(35, 28.6), dms(3, 49.1)], w: 243, dur: 5 * 60 + 22.4 },
  { ut: '10:00', n: [dms(27, 51.4), dms(31, 44.0)], s: [dms(25, 55.3), dms(30, 18.2)], c: [dms(26, 53.3), dms(31, 0.8)], w: 257, dur: 6 * 60 + 23.2 },
  { ut: '10:06', n: [dms(26, 34.9), dms(33, 44.1)], s: [dms(24, 41.7), dms(32, 14.2)], c: [dms(25, 38.3), dms(32, 58.8)], w: 258, dur: 6 * 60 + 22.7 },
];

let worst = 0;
console.log('Central line / limits vs NASA path table (km error):');
for (const r of rows) {
  const [hh, mm] = r.ut.split(':').map(Number);
  const t = utHoursToT(hh + mm / 60);
  const u = umbraAt(t);
  const check = (label, pt, ref) => {
    const ll = toLatLon(pt.P);
    const refP = [Math.cos(ref[0] * DEG) * Math.cos(ref[1] * DEG), Math.cos(ref[0] * DEG) * Math.sin(ref[1] * DEG), Math.sin(ref[0] * DEG)];
    const mine = [Math.cos(ll.lat) * Math.cos(ll.lon), Math.cos(ll.lat) * Math.sin(ll.lon), Math.sin(ll.lat)];
    const err = distanceKm(mine, refP);
    worst = Math.max(worst, err);
    return `${label} ${fmt(ll.lat, 'N', 'S')} ${fmt(ll.lon, 'E', 'W')} (Δ ${err.toFixed(1)} km)`;
  };
  const width = distanceKm(u.north.P, u.south.P);
  const dur = centralDuration(t);
  console.log(`  ${r.ut} UT  ${check('C', u.centre, r.c)}  ${check('N', u.north, r.n)}  ${check('S', u.south, r.s)}`);
  console.log(`           width ${width.toFixed(1)} km (NASA ${r.w})  duration ${dur.toFixed(1)} s (NASA ${r.dur.toFixed(1)})`);
}
console.log(`  worst position error: ${worst.toFixed(1)} km`);

const c = contacts();
console.log('\nContacts (UT):');
for (const k of ['p1', 'u1', 'ge', 'u4', 'p4']) console.log(`  ${k.toUpperCase()} ${formatUT(c[k])}`);
console.log(`  gamma ${c.gamma.toFixed(4)} (NASA 0.1421)   GE NASA 10:06:37.7`);

const ge = umbraAt(c.ge);
const ll = toLatLon(ge.centre.P);
console.log(`  GE point ${fmt(ll.lat, 'N', 'S')} ${fmt(ll.lon, 'E', 'W')} (NASA 25°30.3'N 033°11.0'E), duration ${centralDuration(c.ge).toFixed(1)} s (NASA 382.6)`);

console.log('\nLocal circumstances:');
for (const [name, lat, lon] of [['Luxor', 25.687, 32.640], ['Cádiz', 36.527, -6.289], ['Madrid', 40.417, -3.703], ['Cairo', 30.044, 31.236], ['Jeddah', 21.543, 39.173]]) {
  const lc = localCircumstances(lat, lon);
  const tot = lc.totalDuration != null ? `TOTAL ${lc.totalDuration.toFixed(1)} s (${formatUT(lc.c2)}–${formatUT(lc.c3)})` : `partial, obscuration ${(lc.obscuration * 100).toFixed(1)}%`;
  console.log(`  ${name.padEnd(8)} max ${formatUT(lc.tMax)} UT  mag ${lc.magnitude.toFixed(3)}  ${tot}  sun alt ${lc.sunAltDeg.toFixed(1)}°`);
}
console.log(`\nMoon height above fundamental plane at t0: ${moonHeight(elementsAt(0)).toFixed(2)} ER`);
