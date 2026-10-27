import { ATMOSPHERE_GLSL } from './atmosphere.glsl';
import { SHADOW_FRAGMENT_PARS, SHADOW_VERTEX_PARS } from './lighting.glsl';

/**
 * The creatures' shaders. The legs, the head, the ears, the wings, the fins, the bell of a jelly and
 * its tentacles are all posed in the vertex shader from a few numbers per creature, and each
 * species' coat is painted in the fragment shader from the position on its own model, so a whole
 * herd is one draw call and the textures are smooth and procedural (no image files).
 *
 * Per vertex: `aPart` (look, how it moves, a group number, a side), `aHip` (where it turns) and
 * `aAux` (a weight along its piece, and the knee of a lower leg). Per creature: `iPos` (where it
 * is and a seed), `iData` (heading, size, the phase of its gait and how much of the gait it has),
 * `iState` (the flash of a blow, how far it has appeared, bank and pitch) and `iMood` (alarm,
 * anger, the lunge of a blow and the lowering of a head to graze). See `wildlife-shapes.ts` for the
 * kinds of movement (`HOW`).
 */

const ANIMATION_GLSL = /* glsl */ `
attribute vec4 iPos;    // x, y, z of its feet (the underside of a swimmer or a flier), and a seed in 0..1
attribute vec4 iData;   // heading, size, phase of the gait, amount of gait (0 standing, 1 at full swing)
attribute vec4 iState;  // flash of a blow, how far it has appeared (0..1), bank (+ left), pitch (+ nose up)
attribute vec4 iMood;   // alarm, anger, lunge of a blow, head lowered to graze
attribute vec4 aPart;   // look, how it moves, group (phase, reach), side
attribute vec3 aHip;    // where the piece turns, in the model's own space
attribute vec4 aAux;    // weight along the piece; for a lower leg, x y z of the knee

// What sets a species' carriage apart.
uniform vec4 uLegs;     // swing of a leg, bend of a knee, height of a stride, 0 for a bob and 1 for a hop
uniform vec4 uHead;     // head lowered to graze, head raised in alarm, head lowered to strike, shove of a blow
uniform vec4 uFlight;   // beat of a wing, rest dihedral, sweep back in a dive, bank in a turn
uniform vec4 uSwim;     // sway of a body or a tentacle, waves along it, ripple of a fin, pulse of a bell
uniform float uClock;   // seconds, for the small motions that go on whatever the creature is doing

vec3 rotX(vec3 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z);
}

vec3 rotY(vec3 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

vec3 rotZ(vec3 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * v.x - s * v.y, s * v.x + c * v.y, v.z);
}

// Puts a vertex of the model where this creature has it, in the world.
void poseVertex(vec3 p, vec3 n, out vec3 wp, out vec3 wn) {
  int how = int(aPart.y + 0.5);
  float group = aPart.z;
  float side = aPart.w;
  float weight = aAux.x;
  float seed = iPos.w;
  float phase = iData.z;
  float gait = iData.w;
  float alarm = iMood.x;
  float anger = iMood.y;
  float lunge = iMood.z;
  float graze = iMood.w;

  if (how == 1 || how == 2) {
    // A leg swings about its hip; the part below the knee folds back as the foot lifts.
    float a = phase + group * 3.14159265;
    float swing = -uLegs.x * gait * sin(a);
    if (how == 2) {
      float flex = uLegs.y * gait * max(0.0, cos(a));
      vec3 knee = aAux.yzw;
      p = knee + rotX(p - knee, flex);
      n = rotX(n, flex);
    }
    p = aHip + rotX(p - aHip, swing);
    n = rotX(n, swing);
  } else if (how == 3) {
    // The head lowers to graze, rises to look, nods with the stride and goes down to strike.
    float down = max(anger * 0.45, lunge);
    float pitch = uHead.x * graze - uHead.y * alarm + uHead.z * down
                + 0.05 * gait * sin(phase * 2.0) + 0.02 * sin(uClock * 0.9 + seed * 40.0);
    p = aHip + rotX(p - aHip, pitch);
    n = rotX(n, pitch);
  } else if (how == 4) {
    // An ear or a tail lifts with alarm and flicks now and then.
    float turn = group * alarm + 0.06 * sin(uClock * 3.1 + seed * 50.0 + aHip.x * 30.0);
    p = aHip + rotX(p - aHip, turn);
    n = rotX(n, turn);
  } else if (how == 5) {
    // A wing flaps about its shoulder, the tip lagging behind the root, and sweeps back in a dive.
    float flap = uFlight.x * sin(phase - weight * 0.9) * (0.35 + 0.65 * weight);
    float lift = side * (uFlight.y + flap);
    float sweep = side * uFlight.z * lunge;
    p = aHip + rotY(rotZ(p - aHip, lift), sweep);
    n = rotY(rotZ(n, lift), sweep);
  } else if (how == 6) {
    // A body undulates from the head to the tail; the tail of a ray also rears up to sting.
    float wave = sin(phase - weight * uSwim.y);
    p.x += uSwim.x * weight * weight * wave;
    if (group > 0.5) {
      float rear = lunge * 1.5 * weight;
      p = aHip + rotX(p - aHip, rear);
      n = rotX(n, rear);
    }
  } else if (how == 7) {
    // The wings of a ray ripple from the middle out, the tips moving the most.
    p.y += uSwim.z * weight * sin(phase - abs(p.x) * 2.4 - p.z * 1.1);
  } else if (how == 8) {
    // The bell of a jelly squeezes in as it pulses.
    float pulse = sin(phase);
    vec3 d = p - aHip;
    d.xz *= 1.0 + uSwim.w * pulse;
    d.y *= 1.0 - 0.7 * uSwim.w * pulse;
    p = aHip + d;
  } else if (how == 9) {
    // A tentacle trails the pulse in a slow wave, and lashes more when its jelly is startled.
    float lag = phase * 0.8 - weight * 3.0 + group;
    float lash = uSwim.x * weight * weight * (1.0 + alarm);
    p.x += lash * sin(lag);
    p.z += lash * cos(lag * 0.83 + 1.0);
    p.y += 0.2 * uSwim.w * weight * sin(phase);
  }

  // The stride lifts the whole body, a hop more than a walk, and a blow shoves it forward.
  float bounce = mix(abs(sin(phase)), max(0.0, sin(phase + 0.6)), uLegs.w);
  p.y += uLegs.z * gait * bounce;
  p.z += uHead.w * lunge;

  // It leans into the climb or the dive and banks into a turn.
  if (iState.w != 0.0) {
    p = rotX(p, -iState.w);
    n = rotX(n, -iState.w);
  }
  float roll = -iState.z * uFlight.w;
  if (roll != 0.0) {
    p = rotZ(p, roll);
    n = rotZ(n, roll);
  }

  p *= iData.y * iState.y;
  wp = rotY(p, iData.x) + iPos.xyz;
  wn = rotY(n, iData.x);
}
`;

export const WILD_VERTEX = /* glsl */ `
${SHADOW_VERTEX_PARS}
${ANIMATION_GLSL}
varying vec3 vWorld;
varying vec3 vNormal;
varying float vViewDepth;
varying vec3 vLocal;
varying float vLook;
varying float vHow;
varying float vWeight;
varying vec4 vMood;
varying float vSeed;

void main() {
  vec3 wp;
  vec3 wn;
  poseVertex(position, normal, wp, wn);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  vViewDepth = -mv.z;
  vWorld = wp;
  vNormal = wn;
  vLocal = position;
  vLook = aPart.x;
  vHow = aPart.y;
  vWeight = aAux.x;
  vMood = vec4(iMood.x, iMood.y, iMood.z, iState.x);
  vSeed = iPos.w;
  writeShadowVaryings(wp, wn, vViewDepth);
}
`;

export const WILD_FRAGMENT = /* glsl */ `
${SHADOW_FRAGMENT_PARS}
${ATMOSPHERE_GLSL}

uniform vec4 uLook[8];    // color of each look, and its gloss
uniform vec4 uFinish[8];  // opacity, glow (times the color), how much light shines through it
uniform vec4 uTone;       // x: 1 if a share of them wear the other coat, y: countershading, z: which coat is painted
uniform vec3 uEyeGlow;    // what the eyes give off when it is angry
uniform vec4 uWater;      // x: height of the lake's surface, y: how fast the lake takes the light, z: 1 for a creature that lives in it

varying vec3 vWorld;
varying vec3 vNormal;
varying float vViewDepth;
varying vec3 vLocal;
varying float vLook;
varying float vHow;
varying float vWeight;
varying vec4 vMood;       // alarm, anger, lunge, flash
varying float vSeed;

float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash13s(i);
  float b = hash13s(i + vec3(1.0, 0.0, 0.0));
  float c = hash13s(i + vec3(0.0, 1.0, 0.0));
  float d = hash13s(i + vec3(1.0, 1.0, 0.0));
  float e = hash13s(i + vec3(0.0, 0.0, 1.0));
  float g = hash13s(i + vec3(1.0, 0.0, 1.0));
  float h = hash13s(i + vec3(0.0, 1.0, 1.0));
  float k = hash13s(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}

// Round spots on a jittered grid: 1 inside a spot, 0 outside. density: share of the cells that hold one.
float spots(vec3 p, float density, float radius) {
  vec3 i = floor(p);
  vec3 f = fract(p) - 0.5;
  float on = step(1.0 - density, hash13s(i));
  vec3 jitter = (vec3(hash13s(i + 17.3), hash13s(i + 41.7), hash13s(i + 83.1)) - 0.5) * (0.9 - 2.0 * radius);
  return on * (1.0 - smoothstep(radius * 0.7, radius, length(f - jitter)));
}

// Cells on a jittered grid: x the distance to the nearest centre, y to the next nearest, z a number for the nearest cell.
vec3 cells(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float first = 8.0;
  float second = 8.0;
  float id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(hash13s(vec3(i + g, 1.7)), hash13s(vec3(i + g, 9.1)));
      float d = length(g + o - f);
      if (d < first) {
        second = first;
        first = d;
        id = hash13s(vec3(i + g, 5.3));
      } else if (d < second) {
        second = d;
      }
    }
  }
  return vec3(first, second, id);
}

// The coat of one creature, painted over the color of the piece it is on. glow and eyeMask are added to.
vec3 paint(int li, vec3 base, vec3 N, inout float glow, inout float eyeMask) {
  vec3 p = vLocal;
  int pattern = int(uTone.z + 0.5);
  float other = step(0.55, fract(vSeed * 7.31));
  vec3 belly = uLook[1].rgb;
  vec3 trim = uLook[2].rgb;
  vec3 dark = uLook[3].rgb;
  vec3 mark = uLook[5].rgb;
  vec3 alt = uLook[7].rgb;

  if (li == 0) {
    if (uTone.x > 0.5) base = mix(base, alt, other);
    // Pale underneath: the coat fades to the belly where the surface faces down.
    vec3 under = pattern == 7 ? mix(belly, alt, other) : belly;
    base = mix(base, under, smoothstep(0.05, -0.55, N.y) * uTone.y);
  }

  if (pattern == 1) {
    if (li == 0) {
      // A stag: cream dapples over the back and flanks, darker lower legs and a dark line along the spine.
      float back = smoothstep(0.68, 0.92, p.y) * step(p.z, 0.58) * step(-0.66, p.z);
      float dots = spots(p * 5.5, 0.6, 0.3) * back;
      base = mix(base, mark, dots * 0.8);
      base *= mix(0.6, 1.0, smoothstep(0.18, 0.55, p.y));
      base *= 1.0 - 0.22 * smoothstep(0.98, 1.15, p.y) * (1.0 - dots);
    }
  } else if (pattern == 2) {
    if (li == 0) {
      // A hare: mottled, with dark tips to the ears.
      float n = vnoise(p * 24.0) * 0.6 + vnoise(p * 60.0) * 0.4;
      base = mix(base, mark, smoothstep(0.45, 0.8, n) * 0.5);
      if (vHow > 3.5 && vHow < 4.5) base = mix(base, dark, smoothstep(0.7, 0.92, vWeight));
    }
  } else if (pattern == 3) {
    if (li == 2) {
      // A mossback's shell: plates with dark seams between them, and moss creeping over the crown.
      vec3 c = cells(p.xz * 3.2);
      float seam = smoothstep(0.03, 0.16, c.y - c.x);
      base = mix(dark, base * (0.75 + 0.5 * c.z), seam);
      float m = vnoise(p * 5.0) * 0.65 + vnoise(p * 13.0) * 0.35;
      float mossy = smoothstep(0.5, 0.64, m + (p.y - 0.5) * 0.35);
      base = mix(base, mark * (0.8 + 0.4 * vnoise(p * 30.0)), mossy * 0.85);
    } else if (li == 0) {
      base *= 0.8 + 0.4 * vnoise(p * 40.0);
    } else if (li == 5) {
      base *= 0.7 + 0.6 * vnoise(p * 26.0);
    }
  } else if (pattern == 4) {
    if (li == 0) {
      // A fish of the shoal: a bright stripe down its side, shimmering scales and a painted eye.
      float stripe = (1.0 - smoothstep(0.007, 0.016, abs(p.y - 0.058))) * smoothstep(-0.15, -0.02, p.z);
      base = mix(base, mark, stripe * 0.9);
      glow += stripe * 0.3;
      base *= 0.88 + 0.24 * vnoise(p * vec3(150.0, 150.0, 70.0));
      float eye = 1.0 - smoothstep(0.011, 0.016, length(vec3(abs(p.x) - 0.031, p.y - 0.07, p.z - 0.114)));
      base = mix(base, uLook[4].rgb, eye);
      eyeMask = max(eyeMask, eye);
    }
  } else if (pattern == 5) {
    if (li == 0) {
      // A ray: pale spots over a dark back, a line down the spine and an eye on each side.
      float top = smoothstep(0.1, 0.5, N.y);
      float dots = spots(vec3(p.x * 3.6, 0.5, p.z * 3.6), 0.5, 0.34) * top;
      base = mix(base, mark, dots * 0.85);
      base *= 1.0 - 0.15 * (1.0 - smoothstep(0.0, 0.08, abs(p.x))) * top;
      float eye = (1.0 - smoothstep(0.04, 0.056, length(vec2(abs(p.x) - 0.24, p.z - 0.36)))) * top;
      base = mix(base, uLook[4].rgb, eye);
      eyeMask = max(eyeMask, eye);
    }
  } else if (pattern == 6) {
    if (li == 0) {
      // A jelly's bell: ribs running down it, glowing toward the rim.
      float rib = 0.5 + 0.5 * cos(atan(p.z, p.x) * 14.0);
      base = mix(base, mark, rib * 0.35);
      base = mix(base, uLook[6].rgb, smoothstep(0.62, 0.46, p.y) * 0.35);
    } else if (li == 2) {
      glow += pow(vWeight, 2.5) * 0.9;
    }
  } else if (pattern == 7) {
    if (li == 0 && vHow > 4.5 && vHow < 5.5) {
      // A finch's wing: a pale bar across it and dark flight feathers.
      float bar = smoothstep(0.34, 0.4, vWeight) * (1.0 - smoothstep(0.5, 0.56, vWeight));
      base = mix(base, mark, bar * 0.9);
      base = mix(base, trim, smoothstep(0.7, 0.9, vWeight));
    } else if (li == 0) {
      float eye = 1.0 - smoothstep(0.007, 0.011, length(vec3(abs(p.x) - 0.032, p.y - 0.152, p.z - 0.095)));
      base = mix(base, uLook[4].rgb, eye);
      eyeMask = max(eyeMask, eye);
    }
  } else if (pattern == 8) {
    if (li == 0) {
      if (vHow > 4.5 && vHow < 5.5) {
        // A kite's wing: dark at the tips, a pale patch near the wrist, streaked.
        base = mix(base, trim, smoothstep(0.6, 0.85, vWeight));
        float wrist = smoothstep(0.3, 0.4, vWeight) * (1.0 - smoothstep(0.5, 0.6, vWeight));
        base = mix(base, mark, wrist * 0.55);
      }
      base *= 0.8 + 0.4 * vnoise(p * vec3(60.0, 60.0, 14.0));
    } else if (li == 2) {
      // Barred tail and finger feathers.
      base *= 0.7 + 0.5 * step(0.5, fract(p.z * 12.0));
    }
  }
  return base;
}

void main() {
  int li = int(vLook + 0.5);
  vec4 spec = uLook[li];
  vec4 finish = uFinish[li];
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);

  float glow = finish.y;
  float eyeMask = li == 4 ? 1.0 : 0.0;
  vec3 base = paint(li, spec.rgb, N, glow, eyeMask);
  float gloss = spec.a;
  float alpha = finish.x;

  float shadow = sunShadow(vViewDepth);
  float ndl = dot(N, uKeyDir);
  // Soft wrapped light, so that a body rounds off into its shade the way fur and skin do.
  float diff = clamp((ndl + 0.3) / 1.3, 0.0, 1.0);
  vec3 H = normalize(uKeyDir + V);
  float shine = pow(max(dot(N, H), 0.0), mix(8.0, 120.0, gloss)) * gloss * step(0.0, ndl);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  // The low sun shines through the thin parts: ears, wings, fins and a jelly.
  float through = pow(clamp(-ndl, 0.0, 1.0), 1.5) * finish.z;

  vec3 emitted = base * glow;
  vec3 lit = base * (uKeyColor * (diff + through) * shadow + ambientLight(N))
           + uKeyColor * shine * shadow * 0.5
           + uAmbSky * rim * 0.12 * (0.3 + gloss)
           + base * lampLight(vWorld, N)
           + uEyeGlow * (vMood.y * eyeMask);
  lit = mix(lit, vec3(1.0, 0.86, 0.7) * 1.4, vMood.w * 0.7);

  if (uWater.z > 0.5) {
    // In the lake: the water takes the light and the color from what is under it, and a surface seen
    // at a low angle mirrors the sky instead of showing what is below.
    float depth = max(uWater.x - vWorld.y, 0.0);
    float k = 1.0 - exp(-depth * uWater.y);
    vec3 lake = ambientLight(vec3(0.0, 1.0, 0.0)) * 0.95 + uKeyColor * 0.2 * clamp(uKeyDir.y + 0.15, 0.0, 1.0);
    vec3 body = mix(vec3(0.07, 0.2, 0.17), vec3(0.008, 0.06, 0.07), k) * lake;
    lit = mix(lit - emitted, body, k * 0.8) + emitted * (1.0 - 0.5 * k);
    float cosV = clamp(V.y, 0.0, 1.0);
    alpha *= 1.0 - (0.03 + 0.97 * pow(1.0 - cosV, 5.0));
  }

  lit = applyAtmosphere(lit, vWorld);
  gl_FragColor = vec4(lit, alpha);
}
`;

export const WILD_DEPTH_VERTEX = /* glsl */ `
${ANIMATION_GLSL}
void main() {
  vec3 wp;
  vec3 wn;
  poseVertex(position, normal, wp, wn);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

export const WILD_DEPTH_FRAGMENT = /* glsl */ `
void main() {
  gl_FragColor = vec4(1.0);
}
`;
