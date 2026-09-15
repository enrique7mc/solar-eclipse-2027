# Solar Eclipse 2027 · 3D shadow track

Interactive 3D visualization of the **total solar eclipse of 2 August 2027**, the next
total eclipse after September 2026. An Earth globe shows the Moon's umbra and penumbra
sweeping from the Atlantic across Spain, North Africa, Egypt and Arabia to the Indian
Ocean, with a timeline you can play or scrub.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/
npm run check      # cross-check the geometry against NASA's published path table
```

## What you see

- **Umbra and penumbra** are computed per pixel in a fragment shader from the Besselian
  elements, so the shadow is exact at any zoom level. The thin orange ring marks the outer
  edge of the penumbra; the darkening inside follows the true fraction of the Sun covered.
- **Path of totality** (band) with northern and southern limits and the central line.
- **Places** panel: 56 cities with computed local circumstances. Cities in the path show
  their totality duration; others show the maximum obscuration. Click one to fly there at
  its maximum eclipse.
- **Moon & shadow cones** toggle and **Earth–Moon view** show the true-scale geometry:
  the Moon about 56 Earth radii away and the umbral cone converging on Egypt.
- **Follow umbra** keeps the camera over the moving shadow while playing.

Keyboard: `Space` play/pause, `←`/`→` step one minute (`Shift` for ten).

URL parameters: `?t=10:06:37` (UT), `paused=1`, `follow=0`, `cones=1`, `view=moon`,
`dist=1.5` (camera distance in Earth radii).

## How it works

`src/eclipse.js` is framework-free eclipse geometry:

- NASA/GSFC Besselian elements (Fred Espenak) for 2027 Aug 02, polynomials in TDT.
- Fundamental-plane to Earth-fixed transform, with the ΔT correction to μ.
- Exact intersection of shadow-cone lines with the WGS-like ellipsoid (f = 1/298.257).
- Umbra outline, path limits (sweep envelope using the ground-relative direction of
  travel), global contacts P1/U1/U4/P4, greatest eclipse, and local circumstances
  (C1–C4, magnitude, obscuration, Sun altitude) by scanning and bisection.

`scripts/check-elements.mjs` compares the central line, path limits, width and duration
against NASA's path table. Positions agree to about 1 km and durations to 0.1 s.

`src/earth.js` holds the globe shader. `src/main.js` wires the three.js scene, the
timeline, camera behaviours and the UI.

## Data and credits

- Besselian elements and reference values: Fred Espenak, NASA/GSFC Eclipse Web Site,
  <https://eclipse.gsfc.nasa.gov/SEgoogle/SEgoogle2001/SE2027Aug02Tgoogle.html>
- Day texture: NASA Blue Marble Next Generation, August (Reto Stöckli, NASA Earth Observatory).
- Night texture: NASA Black Marble 2016 (NASA Earth Observatory / Suomi NPP VIIRS).
- Rendering: [three.js](https://threejs.org).
