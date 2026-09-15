/**
 * Earth globe with the eclipse shadow computed per fragment.
 *
 * The fragment shader maps each surface point into the Besselian fundamental frame and
 * evaluates the local umbra/penumbra radii, so the shadow is exact for every pixel: no
 * projected decal, no polygon outline. Lighting uses the shadow-axis direction as the Sun.
 */
import * as THREE from 'three';
import { E2, OMF2 } from './eclipse.js';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vObj;
  void main() {
    vUv = uv;
    vObj = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform vec3 uXi;     // fundamental-frame basis, Earth-fixed coordinates
  uniform vec3 uEta;
  uniform vec3 uZeta;
  uniform vec2 uAxis;   // (x, y) of the shadow axis on the fundamental plane
  uniform float uL1;    // penumbra radius on the fundamental plane
  uniform float uL2;    // umbra radius (signed, negative = total)
  uniform float uTanF1;
  uniform float uTanF2;
  uniform float uEdgeAlpha;
  uniform float uPenumbraGain;
  uniform vec3 uCamPosObj;
  varying vec2 vUv;
  varying vec3 vObj;

  const float E2 = ${E2.toFixed(9)};
  const float OMF2 = ${OMF2.toFixed(9)};
  const float PI = 3.141592653589793;

  // Fraction of the solar disc covered for magnitude m and radius ratio rho (Moon/Sun).
  float obscuration(float m, float rho) {
    if (m <= 0.0) return 0.0;
    float s = 1.0 + rho - 2.0 * m;
    if (s <= abs(1.0 - rho)) return rho >= 1.0 ? 1.0 : rho * rho;
    if (s >= 1.0 + rho) return 0.0;
    float a1 = acos(clamp((s * s + rho * rho - 1.0) / (2.0 * s * rho), -1.0, 1.0));
    float a2 = acos(clamp((s * s + 1.0 - rho * rho) / (2.0 * s), -1.0, 1.0));
    float k = (-s + 1.0 + rho) * (s + 1.0 - rho) * (s - 1.0 + rho) * (s + 1.0 + rho);
    return (rho * rho * a1 + a2 - 0.5 * sqrt(max(k, 0.0))) / PI;
  }

  void main() {
    vec3 p = normalize(vObj);
    // three.js (x, y, z) -> Earth-fixed (X, Y, Z): X = x, Y = -z, Z = y. p is the geodetic normal.
    vec3 pe = vec3(p.x, -p.z, p.y);
    float N = inversesqrt(1.0 - E2 * pe.z * pe.z);
    vec3 P = vec3(pe.xy * N, pe.z * N * OMF2); // point on the ellipsoid, Earth radii

    float xi = dot(P, uXi);
    float eta = dot(P, uEta);
    float zeta = dot(P, uZeta);
    float delta = length(vec2(xi, eta) - uAxis);
    float L1 = uL1 - zeta * uTanF1;
    float L2 = uL2 - zeta * uTanF2;
    float m = (L1 - delta) / (L1 + L2);
    float rho = (L1 - L2) / (L1 + L2);
    float obsc = zeta > 0.0 ? obscuration(m, rho) : 0.0;

    // Lighting. The Sun lies along the shadow axis to within a fraction of a degree.
    float sunCos = dot(pe, uZeta);
    float daylight = smoothstep(-0.06, 0.14, sunCos);
    vec3 day = texture2D(uDay, vUv).rgb;
    vec3 night = texture2D(uNight, vUv).rgb;

    // Eclipse darkening: the penumbra is exaggerated so it reads as a soft disc.
    float dark = pow(obsc, uPenumbraGain);
    float light = mix(1.0, 0.012, dark);
    float diffuse = 0.04 + 1.05 * max(sunCos, 0.0);
    vec3 col = day * diffuse * light;
    // Slight warm-to-blue tint in the deep penumbra, like a real eclipse sky.
    col *= mix(vec3(1.0), vec3(0.85, 0.9, 1.15), dark * 0.6);

    vec3 nightCol = night * night * 2.2 + day * 0.012;
    col = mix(nightCol, col, daylight);

    // Thin rings at the outer edge of the penumbra and at the edge of the umbra.
    float w = max(fwidth(delta) * 1.4, 0.0004);
    float edge = 1.0 - smoothstep(0.0, w, abs(delta - L1));
    col = mix(col, vec3(1.0, 0.75, 0.35), edge * uEdgeAlpha * step(0.0, zeta));
    float wu = max(fwidth(delta) * 1.2, 0.00015);
    float uEdge = 1.0 - smoothstep(0.0, wu, abs(delta - abs(L2)));
    col = mix(col, vec3(1.0, 0.62, 0.25), uEdge * 0.7 * step(0.0, zeta) * step(L2, 0.0));

    // Atmospheric rim.
    vec3 viewDir = normalize(uCamPosObj - vObj);
    float rim = pow(1.0 - max(dot(p, viewDir), 0.0), 3.0);
    col += vec3(0.28, 0.5, 1.0) * rim * (0.45 * daylight + 0.04);

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export function createEarth({ day, night }) {
  const uniforms = {
    uDay: { value: day },
    uNight: { value: night },
    uXi: { value: new THREE.Vector3(1, 0, 0) },
    uEta: { value: new THREE.Vector3(0, 1, 0) },
    uZeta: { value: new THREE.Vector3(0, 0, 1) },
    uAxis: { value: new THREE.Vector2(0, 0) },
    uL1: { value: 0.53 },
    uL2: { value: -0.015 },
    uTanF1: { value: 0.0046 },
    uTanF2: { value: 0.0046 },
    uEdgeAlpha: { value: 0.45 },
    uPenumbraGain: { value: 1.1 },
    uCamPosObj: { value: new THREE.Vector3(0, 0, 3) },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 112), material);
  mesh.name = 'earth';

  // Soft atmospheric halo just outside the globe.
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(1.035, 96, 64),
    new THREE.ShaderMaterial({
      uniforms: { uSun: { value: new THREE.Vector3(0, 0, 1) } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vP;
        void main() { vN = normalize(normalMatrix * normal); vP = (modelViewMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * vec4(vP, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun; varying vec3 vN; varying vec3 vP;
        void main() {
          vec3 v = normalize(-vP);
          float f = pow(1.0 - max(dot(vN, v), 0.0), 4.5);
          float lit = 0.25 + 0.75 * smoothstep(-0.2, 0.3, dot(vN, uSun));
          gl_FragColor = vec4(vec3(0.35, 0.6, 1.0) * f * lit, f * 0.9 * lit);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  mesh.add(halo);

  /** Push a set of Besselian elements (see eclipse.js) into the shader. */
  function update(el, camera) {
    uniforms.uXi.value.set(el.xi[0], el.xi[1], el.xi[2]);
    uniforms.uEta.value.set(el.eta[0], el.eta[1], el.eta[2]);
    uniforms.uZeta.value.set(el.zeta[0], el.zeta[1], el.zeta[2]);
    uniforms.uAxis.value.set(el.x, el.y);
    uniforms.uL1.value = el.l1;
    uniforms.uL2.value = el.l2;
    uniforms.uTanF1.value = el.tanF1;
    uniforms.uTanF2.value = el.tanF2;
    // Halo wants the Sun direction in view space.
    const sunThree = new THREE.Vector3(el.zeta[0], el.zeta[2], -el.zeta[1]);
    if (camera) halo.material.uniforms.uSun.value.copy(sunThree).transformDirection(camera.matrixWorldInverse);
  }

  return { mesh, material, uniforms, update };
}
