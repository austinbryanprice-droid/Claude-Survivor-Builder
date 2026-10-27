/**
 * Original pictograms for the player HUD, drawn as flat painted shapes with a dark ink edge so
 * they read on both bright and dark backgrounds. They are placeholders that stand in for the
 * real item art; ids are stable, so swapping an icon never touches the HUD code.
 *
 * All icons share one hidden SVG sprite (`ICON_SPRITE`); `iconMarkup` makes the `<svg><use>`
 * that draws one of them.
 */

export type IconId =
  | 'blaster'
  | 'blade'
  | 'pick'
  | 'hammer'
  | 'torch'
  | 'bow'
  | 'axe'
  | 'charge'
  | 'cloth'
  | 'flask'
  | 'mushroom'
  | 'shield'
  | 'heart'
  | 'spire'
  | 'sun'
  | 'moon'
  | 'core'
  | 'bolt'
  | 'lock'
  | 'research'
  | 'terminal'
  | 'turret'
  | 'generator'
  | 'node'
  | 'storage'
  | 'bed'
  | 'light'
  | 'block-scrap'
  | 'block-composite'
  | 'block-alloy'
  | 'block-energy'
  | 'slab-scrap'
  | 'slab-composite'
  | 'slab-alloy'
  | 'slab-energy'
  | 'wedge-scrap'
  | 'wedge-composite'
  | 'wedge-alloy'
  | 'wedge-energy';

export const ICON_IDS: readonly IconId[] = [
  'blaster',
  'blade',
  'pick',
  'hammer',
  'torch',
  'bow',
  'axe',
  'charge',
  'cloth',
  'flask',
  'mushroom',
  'shield',
  'heart',
  'spire',
  'sun',
  'moon',
  'core',
  'bolt',
  'lock',
  'research',
  'terminal',
  'turret',
  'generator',
  'node',
  'storage',
  'bed',
  'light',
  'block-scrap',
  'block-composite',
  'block-alloy',
  'block-energy',
  'slab-scrap',
  'slab-composite',
  'slab-alloy',
  'slab-energy',
  'wedge-scrap',
  'wedge-composite',
  'wedge-alloy',
  'wedge-energy',
];

const INK = '#1b1e25';

/**
 * A building block seen from above and the side, painted in the tier's colors: the light top, the
 * mid left face and the dark right face, each with the inset panel that stands for the bevel, and
 * the marks that tell the materials apart.
 */
interface BlockPaint {
  readonly top: string;
  readonly left: string;
  readonly right: string;
  readonly marks: string;
}

function blockSymbol(name: string, paint: BlockPaint): string {
  return /* html */ `
<symbol id="ph-i-block-${name}" viewBox="0 0 48 48">
  <path d="M6 14 L24 23 L24 43 L6 34 Z" fill="${paint.left}"/>
  <path d="M24 23 L42 14 L42 34 L24 43 Z" fill="${paint.right}"/>
  <path d="M24 5 L42 14 L24 23 L6 14 Z" fill="${paint.top}"/>
  <path d="M24 7 L38 14 L24 21 L10 14 Z M8 17.2 L22 24.2 L22 39.8 L8 32.8 Z M40 17.2 L26 24.2 L26 39.8 L40 32.8 Z" fill="#fff" fill-opacity="0.13" stroke="#000" stroke-opacity="0.3" stroke-width="0.9" stroke-linejoin="round"/>
  ${paint.marks}
  <path d="M24 5 L42 14 V34 L24 43 L6 34 V14 Z M6 14 L24 23 L42 14 M24 23 V43" fill="none" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>
</symbol>`;
}

const BLOCK_PAINTS: Readonly<Record<string, BlockPaint>> = {
  // Scrap: rusted plates with a salvaged teal patch and rivets.
  scrap: {
    top: '#b0724a',
    left: '#8a523a',
    right: '#64392a',
    marks: /* html */ `
  <path d="M10 20.2 L18 24.2 L18 30.4 L10 26.4 Z" fill="#3f8f8a" stroke="${INK}" stroke-opacity="0.55" stroke-width="0.8" stroke-linejoin="round"/>
  <path d="M28.5 28 L37.5 23.5 M28.5 33.5 L37.5 29" stroke="#3d2216" stroke-width="1.1" stroke-linecap="round"/>
  <circle cx="24" cy="9.2" r="1" fill="#2b1912"/><circle cx="35.6" cy="14" r="1" fill="#2b1912"/><circle cx="24" cy="18.8" r="1" fill="#2b1912"/><circle cx="12.4" cy="14" r="1" fill="#2b1912"/>`,
  },
  // Reinforced Composite: grey-green panels with cyan trim.
  composite: {
    top: '#a6b8a8',
    left: '#7e9484',
    right: '#5b7064',
    marks: /* html */ `
  <path d="M26 27.5 L40 20.5 L40 23.4 L26 30.4 Z" fill="#6ad7e6" stroke="${INK}" stroke-opacity="0.45" stroke-width="0.7" stroke-linejoin="round"/>
  <path d="M10 24.2 L22 30.2" stroke="#6ad7e6" stroke-opacity="0.85" stroke-width="1.2" stroke-linecap="round"/>
  <path d="M13 14.9 L24 20.2 L35 14.9" fill="none" stroke="#d3f3f7" stroke-opacity="0.7" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  // Advanced Alloy: bright steel with an amber hazard band.
  alloy: {
    top: '#cfd8e2',
    left: '#9aa8b8',
    right: '#6d7b8c',
    marks: /* html */ `
  <path d="M8 28.4 L22 35.4 L22 39.8 L8 32.8 Z" fill="#e0a82e"/>
  <path d="M11 29.9 L13 30.9 L13 35.3 L11 34.3 Z M15.5 32.15 L17.5 33.15 L17.5 37.55 L15.5 36.55 Z M20 34.4 L22 35.4 L22 39.8 L20 38.8 Z" fill="${INK}" fill-opacity="0.78"/>
  <path d="M26 24.6 L40 17.6" stroke="#f4f8fc" stroke-opacity="0.55" stroke-width="1.2" stroke-linecap="round"/>
  <circle cx="30" cy="31" r="1" fill="#44505f"/><circle cx="36" cy="28" r="1" fill="#44505f"/>`,
  },
  // Energy-Infused: dark graphite cut with glowing cyan veins.
  energy: {
    top: '#3b434e',
    left: '#2a3038',
    right: '#1e232a',
    marks: /* html */ `
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 14 L21 16.5 L25 12 L33 15 M10.5 22 L14.5 26.5 L12.5 31.5 L16.5 35 M33 24.5 L36.5 20.5 L35 28 L38 30" stroke="#59e6ff" stroke-opacity="0.28" stroke-width="3.2"/>
    <path d="M14 14 L21 16.5 L25 12 L33 15 M10.5 22 L14.5 26.5 L12.5 31.5 L16.5 35 M33 24.5 L36.5 20.5 L35 28 L38 30" stroke="#8cf0ff" stroke-width="1.2"/>
  </g>`,
  },
};

const BLOCK_SYMBOLS = Object.entries(BLOCK_PAINTS)
  .map(([name, paint]) => blockSymbol(name, paint))
  .join('\n');

type Face = 'top' | 'left' | 'right';

/** The three faces of the whole block in the icon, and the inset panel of each. */
const FACE_PATHS: Readonly<Record<Face, string>> = {
  top: 'M24 5 L42 14 L24 23 L6 14 Z',
  left: 'M6 14 L24 23 L24 43 L6 34 Z',
  right: 'M24 23 L42 14 L42 34 L24 43 Z',
};
const FACE_PANELS: Readonly<Record<Face, string>> = {
  top: 'M24 7 L38 14 L24 21 L10 14 Z',
  left: 'M8 17.2 L22 24.2 L22 39.8 L8 32.8 Z',
  right: 'M40 17.2 L26 24.2 L26 39.8 L40 32.8 Z',
};

/** Where the face of a shape comes from on the whole block, and the move that carries its paint there. */
interface FacePlacement {
  readonly face: Face;
  /** The clip path (see the sprite's defs) that cuts the part of the block's face the shape shows. */
  readonly clip: string;
  /** An SVG matrix, `a b c d e f`. */
  readonly matrix: string;
}

/**
 * A slab is the lower half of the block: each side face drops to half its height and the top
 * face comes down with it. Each move is exact for its face, so the paint keeps its marks.
 */
const SLAB_FACES: readonly FacePlacement[] = [
  { face: 'left', clip: 'ph-clip-left', matrix: '1 0.25 0 0.5 0 15.5' },
  { face: 'right', clip: 'ph-clip-right', matrix: '1 -0.25 0 0.5 0 27.5' },
  { face: 'top', clip: 'ph-clip-top', matrix: '1 0 0 1 0 10' },
];
const SLAB_OUTLINE = 'M24 15 L42 24 V34 L24 43 L6 34 V24 Z M6 24 L24 33 L42 24 M24 33 V43';

/**
 * A wedge rising toward the back right: the top face stretches down to the front edge to make the
 * slope, and the half of the right face below the diagonal is its side.
 */
const WEDGE_FACES: readonly FacePlacement[] = [
  { face: 'top', clip: 'ph-clip-top', matrix: '1 -0.5556 0 2.1111 0 7.7778' },
  { face: 'right', clip: 'ph-clip-wedge-side', matrix: '1 0 0 1 0 0' },
];
const WEDGE_OUTLINE = 'M6 34 L24 5 L42 14 V34 L24 43 Z M24 43 L42 14';

function placedFace(paint: BlockPaint, { face, clip, matrix }: FacePlacement): string {
  return /* html */ `<g transform="matrix(${matrix})"><g clip-path="url(#${clip})">
    <path d="${FACE_PATHS[face]}" fill="${paint[face]}"/>
    <path d="${FACE_PANELS[face]}" fill="#fff" fill-opacity="0.13" stroke="#000" stroke-opacity="0.3" stroke-width="0.9" stroke-linejoin="round"/>
    ${paint.marks}
  </g></g>`;
}

function shapedSymbol(
  id: string,
  paint: BlockPaint,
  faces: readonly FacePlacement[],
  outline: string,
): string {
  return /* html */ `
<symbol id="ph-i-${id}" viewBox="0 0 48 48">
  ${faces.map((placement) => placedFace(paint, placement)).join('\n  ')}
  <path d="${outline}" fill="none" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>
</symbol>`;
}

const SHAPE_SYMBOLS = Object.entries(BLOCK_PAINTS)
  .flatMap(([name, paint]) => [
    shapedSymbol(`slab-${name}`, paint, SLAB_FACES, SLAB_OUTLINE),
    shapedSymbol(`wedge-${name}`, paint, WEDGE_FACES, WEDGE_OUTLINE),
  ])
  .join('\n');

const SPRITE_BODY = /* html */ `
<defs>
  <clipPath id="ph-clip-top"><path d="M24 5 L42 14 L24 23 L6 14 Z"/></clipPath>
  <clipPath id="ph-clip-left"><path d="M6 14 L24 23 L24 43 L6 34 Z"/></clipPath>
  <clipPath id="ph-clip-right"><path d="M24 23 L42 14 L42 34 L24 43 Z"/></clipPath>
  <clipPath id="ph-clip-wedge-side"><path d="M24 43 L42 34 L42 14 Z"/></clipPath>
  <linearGradient id="ph-steel" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#e6edf5"/><stop offset="0.55" stop-color="#9fb0c4"/><stop offset="1" stop-color="#5d6d83"/>
  </linearGradient>
  <linearGradient id="ph-steel-dark" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#8c9bb0"/><stop offset="1" stop-color="#3f4b5e"/>
  </linearGradient>
  <linearGradient id="ph-wood" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#b17c4a"/><stop offset="1" stop-color="#6e4526"/>
  </linearGradient>
  <linearGradient id="ph-bronze" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#e4bb62"/><stop offset="1" stop-color="#8f6628"/>
  </linearGradient>
  <linearGradient id="ph-flame" x1="0" y1="1" x2="0" y2="0">
    <stop offset="0" stop-color="#e8561f"/><stop offset="0.6" stop-color="#ffa63a"/><stop offset="1" stop-color="#fff0a0"/>
  </linearGradient>
  <radialGradient id="ph-bomb" cx="0.35" cy="0.3" r="0.8">
    <stop offset="0" stop-color="#6a7585"/><stop offset="1" stop-color="#232a35"/>
  </radialGradient>
  <radialGradient id="ph-sun" cx="0.38" cy="0.32" r="0.85">
    <stop offset="0" stop-color="#fff3b0"/><stop offset="0.55" stop-color="#ffc24a"/><stop offset="1" stop-color="#e8851f"/>
  </radialGradient>
  <linearGradient id="ph-moon" x1="0.1" y1="0" x2="0.9" y2="1">
    <stop offset="0" stop-color="#f4f8ff"/><stop offset="0.6" stop-color="#bcd0f2"/><stop offset="1" stop-color="#7f97c8"/>
  </linearGradient>
  <linearGradient id="ph-core" x1="0.15" y1="0" x2="0.85" y2="1">
    <stop offset="0" stop-color="#eaffff"/><stop offset="0.5" stop-color="#58d6ee"/><stop offset="1" stop-color="#1c7a9c"/>
  </linearGradient>
  <linearGradient id="ph-bolt" x1="0.2" y1="0" x2="0.8" y2="1">
    <stop offset="0" stop-color="#fff6c4"/><stop offset="0.5" stop-color="#ffc83d"/><stop offset="1" stop-color="#e9831d"/>
  </linearGradient>
  <linearGradient id="ph-glass" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#f4fbff" stop-opacity="0.85"/><stop offset="1" stop-color="#9fc7d8" stop-opacity="0.55"/>
  </linearGradient>
</defs>

<symbol id="ph-i-blaster" viewBox="0 0 48 48">
  <path d="M12 25 L23 25 L20.6 41.6 Q20.4 43.4 18.6 43.4 L12.2 43.4 Q10.2 43.4 10.4 41.6 Z" fill="url(#ph-steel-dark)" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M12.6 30.4 L20.8 30.4 M12.1 34.8 L20.2 34.8 M11.6 39.2 L19.6 39.2" stroke="#10131a" stroke-opacity="0.5" stroke-width="1.2" stroke-linecap="round"/>
  <path d="M5 13.5 Q5 10.5 8 10.5 L36 10.5 L36 27 L8 27 Q5 27 5 24 Z" fill="url(#ph-steel)" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M36 13.5 L44.2 13.5 Q45.8 13.5 45.8 15.1 L45.8 22.4 Q45.8 24 44.2 24 L36 24 Z" fill="url(#ph-steel-dark)" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M41.2 14.2 L41.2 23.3" stroke="#6ad7e6" stroke-width="2.2" stroke-linecap="round"/>
  <rect x="10.5" y="14.8" width="17" height="7.6" rx="2.6" fill="url(#ph-core)" stroke="${INK}" stroke-width="1.3"/>
  <path d="M12.8 17.2 L24.5 17.2" stroke="#fff" stroke-opacity="0.9" stroke-width="1.1" stroke-linecap="round"/>
  <path d="M23.6 27 Q23.8 33.2 29.2 33.2 Q31.2 33.2 31.2 31.2 L31.2 27" fill="none" stroke="${INK}" stroke-width="1.7" stroke-linecap="round"/>
  <path d="M8 12.6 L33 12.6" stroke="#f6faff" stroke-opacity="0.75" stroke-width="1" stroke-linecap="round"/>
</symbol>

<symbol id="ph-i-blade" viewBox="0 0 48 48">
  <path d="M39 5 L44 10 L22 33 L15 26 Z" fill="url(#ph-steel)" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M38 8 L20 28" stroke="#f6faff" stroke-opacity="0.8" stroke-width="1.2" stroke-linecap="round"/>
  <path d="M11 25 L24 38 L20 42 L7 29 Z" fill="url(#ph-bronze)" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M15 33 L7 41" stroke="#5a3a22" stroke-width="4.4" stroke-linecap="round"/>
  <path d="M15 33 L7 41" stroke="#8a5e38" stroke-width="2" stroke-linecap="round"/>
  <circle cx="6" cy="42" r="3.2" fill="url(#ph-bronze)" stroke="${INK}" stroke-width="1.4"/>
</symbol>

<symbol id="ph-i-pick" viewBox="0 0 48 48">
  <path d="M11 41 L31 13" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
  <path d="M11 41 L31 13" stroke="url(#ph-wood)" stroke-width="3.4" stroke-linecap="round"/>
  <path d="M7 17 C14 6 33 4 44 19 C35 13 22 12 7 17 Z" fill="url(#ph-steel)" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M12 14 C20 10 30 10 38 15" stroke="#f6faff" stroke-opacity="0.7" stroke-width="1.1" fill="none" stroke-linecap="round"/>
</symbol>

<symbol id="ph-i-hammer" viewBox="0 0 48 48">
  <path d="M10 42 L30 17" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
  <path d="M10 42 L30 17" stroke="url(#ph-wood)" stroke-width="3.4" stroke-linecap="round"/>
  <g transform="rotate(-38 31 14)">
    <rect x="17" y="6" width="28" height="15" rx="3" fill="url(#ph-wood)" stroke="${INK}" stroke-width="1.6"/>
    <rect x="17" y="6" width="5" height="15" rx="2" fill="url(#ph-steel-dark)" stroke="${INK}" stroke-width="1.2"/>
    <rect x="40" y="6" width="5" height="15" rx="2" fill="url(#ph-steel-dark)" stroke="${INK}" stroke-width="1.2"/>
  </g>
</symbol>

<symbol id="ph-i-torch" viewBox="0 0 48 48">
  <path d="M24 44 L24 21" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
  <path d="M24 44 L24 21" stroke="url(#ph-wood)" stroke-width="4.2" stroke-linecap="round"/>
  <rect x="19.5" y="15" width="9" height="10" rx="2" fill="#4a3426" stroke="${INK}" stroke-width="1.4"/>
  <path d="M24 3 C31 10 33 15 28.5 19 C27 16.5 26.5 15 24 12.5 C21.5 15 21 16.5 19.5 19 C15 15 17 10 24 3 Z" fill="url(#ph-flame)" stroke="${INK}" stroke-width="1.3" stroke-linejoin="round"/>
</symbol>

<symbol id="ph-i-bow" viewBox="0 0 48 48">
  <path d="M13 5 Q42 24 13 43" stroke="${INK}" stroke-width="6" fill="none" stroke-linecap="round"/>
  <path d="M13 5 Q42 24 13 43" stroke="url(#ph-wood)" stroke-width="3.2" fill="none" stroke-linecap="round"/>
  <path d="M13 5 L13 43" stroke="#efe6cc" stroke-width="1.1"/>
  <path d="M5 24 L43 24" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
  <path d="M5 24 L43 24" stroke="#c6a26a" stroke-width="1.4" stroke-linecap="round"/>
  <path d="M43 24 L37 20 L37 28 Z" fill="url(#ph-steel)" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>
  <path d="M5 24 L9 19 M5 24 L9 29 M9 24 L12 20 M9 24 L12 28" stroke="#b64a3a" stroke-width="1.6" stroke-linecap="round"/>
</symbol>

<symbol id="ph-i-axe" viewBox="0 0 48 48">
  <path d="M9 43 L33 12" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
  <path d="M9 43 L33 12" stroke="url(#ph-wood)" stroke-width="3.4" stroke-linecap="round"/>
  <path d="M25 5 L39 8 C43 15 43 22 41 28 L34 22 L30 15 Z" fill="url(#ph-steel)" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M37 11 C39 16 39 21 38 24" stroke="#f6faff" stroke-opacity="0.75" stroke-width="1.1" fill="none" stroke-linecap="round"/>
</symbol>

<symbol id="ph-i-charge" viewBox="0 0 48 48">
  <circle cx="24" cy="28" r="15" fill="url(#ph-bomb)" stroke="${INK}" stroke-width="1.8"/>
  <path d="M10.5 24 C18 28 30 28 37.5 24 L38.8 29 C31 33 17 33 9.2 29 Z" fill="#c2443a" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>
  <path d="M10 28.5 C18 32.5 30 32.5 38 28.5" stroke="#f0c36a" stroke-width="1.4" fill="none"/>
  <rect x="20" y="9" width="8" height="6" rx="1.6" fill="url(#ph-bronze)" stroke="${INK}" stroke-width="1.4"/>
  <path d="M26 9 Q29 3 36 4" stroke="#d8b878" stroke-width="2" fill="none" stroke-linecap="round"/>
  <path d="M36 4 l3 -2 M36 4 l3 2 M36 4 l-1 -3.4 M36 4 l-1 3.4" stroke="#ffb13a" stroke-width="1.6" stroke-linecap="round"/>
</symbol>

<symbol id="ph-i-cloth" viewBox="0 0 48 48">
  <rect x="8" y="14" width="32" height="22" rx="7" fill="#cdb98f" stroke="${INK}" stroke-width="1.8"/>
  <path d="M14 15 C12 22 12 28 14 35 M22 14.5 C20 22 20 28 22 36 M30 14.5 C28 22 28 28 30 36" stroke="#9d8a62" stroke-width="1.4" fill="none"/>
  <path d="M40 22 C46 22 46 32 40 32" fill="#e3d3ac" stroke="${INK}" stroke-width="1.6"/>
  <path d="M11 18 C20 16 30 16 37 18" stroke="#f6edd2" stroke-width="1.3" fill="none" stroke-linecap="round"/>
</symbol>

<symbol id="ph-i-flask" viewBox="0 0 48 48">
  <path d="M19 6 H29 V15 L39 36 C40.5 40 38.5 43 35 43 H13 C9.5 43 7.5 40 9 36 L19 15 Z" fill="url(#ph-glass)" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
  <path d="M13.2 31 H34.8 L38 37.5 C38.8 40.2 37.6 41.4 35 41.4 H13 C10.4 41.4 9.2 40.2 10 37.5 Z" fill="#59b86e"/>
  <rect x="18" y="3" width="12" height="5" rx="2" fill="url(#ph-bronze)" stroke="${INK}" stroke-width="1.4"/>
  <path d="M21 17 L16 28" stroke="#fff" stroke-opacity="0.8" stroke-width="1.4" stroke-linecap="round"/>
</symbol>

<symbol id="ph-i-mushroom" viewBox="0 0 48 48">
  <path d="M19 26 H29 L30 40 C30 42.5 28 44 24 44 C20 44 18 42.5 18 40 Z" fill="#efe6cc" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
  <path d="M5 27 C5 14 14 6 24 6 C34 6 43 14 43 27 C36 29.5 12 29.5 5 27 Z" fill="#e2a23a" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
  <circle cx="16" cy="18" r="3" fill="#fbe8b0"/><circle cx="28" cy="14" r="2.4" fill="#fbe8b0"/><circle cx="34" cy="22" r="2.6" fill="#fbe8b0"/><circle cx="22" cy="23" r="2" fill="#fbe8b0"/>
</symbol>

<symbol id="ph-i-shield" viewBox="0 0 48 48">
  <path d="M24 4 L41 10 V24 C41 34 34 41 24 45 C14 41 7 34 7 24 V10 Z" fill="url(#ph-steel-dark)" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
  <path d="M24 9 L36 13.5 V24 C36 31.5 31 37 24 40.2 Z" fill="#5f7592" opacity="0.7"/>
  <path d="M24 12 V36 M14 21 H34" stroke="#e6c46c" stroke-width="3" stroke-linecap="round"/>
</symbol>

<symbol id="ph-i-heart" viewBox="0 0 48 48">
  <path d="M24 42 C8 30 4 21 4 14.5 C4 9 8.5 5 13.5 5 C18 5 22 7.5 24 12 C26 7.5 30 5 34.5 5 C39.5 5 44 9 44 14.5 C44 21 40 30 24 42 Z" fill="#e25a6a" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M12 13 C13 10.5 16 9.5 18 10.5" stroke="#ffd0d6" stroke-width="2" fill="none" stroke-linecap="round"/>
</symbol>

<symbol id="ph-i-spire" viewBox="0 0 48 48">
  <path d="M5 38 L17 17 L24 27 L33 10 L43 38" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="M33 10 V4 M30 7 H36" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M3 41 H45" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M17 17 V41 M33 10 V41" stroke="${INK}" stroke-width="1.5" opacity="0.55"/>
</symbol>

<symbol id="ph-i-sun" viewBox="0 0 48 48">
  <g stroke="${INK}" stroke-width="3.4" stroke-linecap="round"><path d="M24 4 V10 M24 38 V44 M4 24 H10 M38 24 H44 M9.9 9.9 L14.1 14.1 M33.9 33.9 L38.1 38.1 M9.9 38.1 L14.1 33.9 M33.9 14.1 L38.1 9.9"/></g>
  <g stroke="#ffd36a" stroke-width="1.8" stroke-linecap="round"><path d="M24 4 V10 M24 38 V44 M4 24 H10 M38 24 H44 M9.9 9.9 L14.1 14.1 M33.9 33.9 L38.1 38.1 M9.9 38.1 L14.1 33.9 M33.9 14.1 L38.1 9.9"/></g>
  <circle cx="24" cy="24" r="10.5" fill="url(#ph-sun)" stroke="${INK}" stroke-width="1.8"/>
  <path d="M18.5 20.5 C19.8 18.2 22 17 24.5 17" stroke="#fff6d0" stroke-opacity="0.8" stroke-width="1.8" fill="none" stroke-linecap="round"/>
</symbol>

<symbol id="ph-i-moon" viewBox="0 0 48 48">
  <path d="M31 5 C21.5 6.5 14 14.5 14 24.5 C14 34.5 21.5 42.5 31 43.5 C22.6 45.6 12 40.5 8.4 31.8 C4.8 23 9 12.6 17.6 8 C21.6 5.8 26.4 4.6 31 5 Z" fill="url(#ph-moon)" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
  <path d="M15.5 17 C17.5 12.8 21 9.8 25 8.4" stroke="#ffffff" stroke-opacity="0.75" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <circle cx="37" cy="13" r="1.6" fill="#dbe7ff"/><circle cx="41" cy="24" r="1.2" fill="#dbe7ff"/><circle cx="35" cy="34" r="1.3" fill="#dbe7ff"/>
</symbol>

<symbol id="ph-i-core" viewBox="0 0 48 48">
  <path d="M9 40 V27 M39 40 V27" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
  <path d="M9 40 V27 M39 40 V27" stroke="url(#ph-bronze)" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M6 42 H42" stroke="${INK}" stroke-width="4.2" stroke-linecap="round"/>
  <path d="M6 42 H42" stroke="url(#ph-steel-dark)" stroke-width="2" stroke-linecap="round"/>
  <path d="M24 4 L33.5 14.5 V27.5 L24 38 L14.5 27.5 V14.5 Z" fill="url(#ph-core)" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
  <path d="M24 4 V38 M14.5 14.5 L33.5 27.5 M33.5 14.5 L14.5 27.5" stroke="#ffffff" stroke-opacity="0.35" stroke-width="1.1" fill="none"/>
  <path d="M17.5 14.2 L24 7.4" stroke="#ffffff" stroke-opacity="0.85" stroke-width="1.7" stroke-linecap="round"/>
</symbol>

<symbol id="ph-i-bolt" viewBox="0 0 48 48">
  <path d="M29 3 L10 26.5 H21 L16.5 45 L38.5 18.5 H27 Z" fill="url(#ph-bolt)" stroke="${INK}" stroke-width="1.9" stroke-linejoin="round"/>
  <path d="M26.5 8.5 L16 22.5" stroke="#fffbe6" stroke-opacity="0.85" stroke-width="1.7" stroke-linecap="round"/>
</symbol>

<symbol id="ph-i-lock" viewBox="0 0 48 48">
  <path d="M15.5 22 V14.5 C15.5 9.6 19.3 6 24 6 C28.7 6 32.5 9.6 32.5 14.5 V22" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
  <path d="M15.5 22 V14.5 C15.5 9.6 19.3 6 24 6 C28.7 6 32.5 9.6 32.5 14.5 V22" fill="none" stroke="url(#ph-steel)" stroke-width="3.2" stroke-linecap="round"/>
  <rect x="8.5" y="20.5" width="31" height="22" rx="4.5" fill="url(#ph-bronze)" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M12.5 24.4 H35.5" stroke="#fff6d0" stroke-opacity="0.6" stroke-width="1.7" stroke-linecap="round"/>
  <circle cx="24" cy="30.2" r="3.5" fill="${INK}"/>
  <path d="M24 31 V36.4" stroke="${INK}" stroke-width="3.6" stroke-linecap="round"/>
</symbol>

<symbol id="ph-i-research" viewBox="0 0 48 48">
  <g fill="none" stroke="${INK}" stroke-width="5.2" stroke-linecap="round">
    <ellipse cx="24" cy="24" rx="19" ry="7.4" transform="rotate(-32 24 24)"/>
    <ellipse cx="24" cy="24" rx="19" ry="7.4" transform="rotate(32 24 24)"/>
    <ellipse cx="24" cy="24" rx="19" ry="7.4" transform="rotate(90 24 24)"/>
  </g>
  <g fill="none" stroke="#c4b3ff" stroke-width="2.4" stroke-linecap="round">
    <ellipse cx="24" cy="24" rx="19" ry="7.4" transform="rotate(-32 24 24)"/>
    <ellipse cx="24" cy="24" rx="19" ry="7.4" transform="rotate(32 24 24)"/>
    <ellipse cx="24" cy="24" rx="19" ry="7.4" transform="rotate(90 24 24)"/>
  </g>
  <circle cx="24" cy="24" r="6.6" fill="url(#ph-core)" stroke="${INK}" stroke-width="1.8"/>
  <path d="M20.6 21.4 C21.4 20 22.8 19.2 24.4 19.1" stroke="#ffffff" stroke-opacity="0.85" stroke-width="1.6" fill="none" stroke-linecap="round"/>
</symbol>

<symbol id="ph-i-terminal" viewBox="0 0 48 48">
  <path d="M33.5 14.5 V7" stroke="${INK}" stroke-width="4.2" stroke-linecap="round"/>
  <path d="M33.5 14.5 V7" stroke="url(#ph-steel)" stroke-width="1.8" stroke-linecap="round"/>
  <circle cx="33.5" cy="5.8" r="2.4" fill="url(#ph-bronze)" stroke="${INK}" stroke-width="1.3"/>
  <path d="M8.4 43.2 H39.6 Q41.4 43.2 41 41.6 L40.2 38.2 H7.8 L7 41.6 Q6.6 43.2 8.4 43.2 Z" fill="url(#ph-steel-dark)" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M9.6 38.2 V19 Q9.6 14.8 13.8 14.8 H34.2 Q38.4 14.8 38.4 19 V38.2 Z" fill="url(#ph-steel)" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round"/>
  <rect x="13.4" y="18.4" width="21.2" height="13.8" rx="2.6" fill="#1b2a36" stroke="${INK}" stroke-width="1.4"/>
  <rect x="15" y="20" width="18" height="10.6" rx="1.8" fill="url(#ph-core)"/>
  <path d="M17.6 23.6 H27.4 M17.6 26.8 H23.6" stroke="#0e2f36" stroke-opacity="0.65" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M16.8 21.8 H25" stroke="#ffffff" stroke-opacity="0.85" stroke-width="1.1" stroke-linecap="round"/>
  <rect x="13.4" y="34" width="21.2" height="2.6" rx="1.3" fill="url(#ph-bronze)" stroke="${INK}" stroke-width="1.1"/>
  <path d="M12.2 17 H35.8" stroke="#f6faff" stroke-opacity="0.7" stroke-width="1" stroke-linecap="round"/>
</symbol>

<symbol id="ph-i-turret" viewBox="0 0 48 48">
  <path d="M8.4 43.2 H39.6 Q41.4 43.2 41 41.6 L40.2 38.2 H7.8 L7 41.6 Q6.6 43.2 8.4 43.2 Z" fill="url(#ph-steel-dark)" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M18.6 38.2 V31 H29.4 V38.2 Z" fill="url(#ph-steel)" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
  <rect x="12.4" y="38.4" width="23.2" height="1.8" rx="0.9" fill="url(#ph-bronze)" stroke="${INK}" stroke-width="0.9"/>
  <rect x="27" y="15.6" width="15.6" height="4.6" rx="1.7" fill="url(#ph-steel-dark)" stroke="${INK}" stroke-width="1.5"/>
  <rect x="39.8" y="13.8" width="4.6" height="8.2" rx="1.7" fill="url(#ph-bronze)" stroke="${INK}" stroke-width="1.3"/>
  <path d="M7.8 31 V19.4 Q7.8 13.8 13.4 13.8 H27.8 Q31 13.8 31 17 V28.4 Q31 31 28.4 31 Z" fill="url(#ph-steel)" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round"/>
  <rect x="21.4" y="16.8" width="6.6" height="4.6" rx="1.6" fill="#1b2a36" stroke="${INK}" stroke-width="1.1"/>
  <rect x="22.6" y="17.9" width="4.2" height="2.4" rx="1" fill="url(#ph-core)"/>
  <path d="M11 16.8 H19.6" stroke="#f6faff" stroke-opacity="0.75" stroke-width="1.1" stroke-linecap="round"/>
  <path d="M10.4 26.8 H26.4" stroke="${INK}" stroke-opacity="0.45" stroke-width="1.3" stroke-linecap="round"/>
</symbol>

<symbol id="ph-i-generator" viewBox="0 0 48 48">
  <path d="M20 10 V5.6" stroke="${INK}" stroke-width="4.2" stroke-linecap="round"/>
  <path d="M20 10 V5.6" stroke="url(#ph-steel)" stroke-width="1.8" stroke-linecap="round"/>
  <circle cx="20" cy="4.8" r="2.4" fill="url(#ph-bronze)" stroke="${INK}" stroke-width="1.3"/>
  <path d="M8.4 43.2 H39.6 Q41.4 43.2 41 41.6 L40.2 38.2 H7.8 L7 41.6 Q6.6 43.2 8.4 43.2 Z" fill="url(#ph-steel-dark)" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M30 32.6 H35" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
  <path d="M30 32.6 H35" stroke="url(#ph-bronze)" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M34.2 38.2 V27 Q34.2 25 36.2 25 H39.4 Q41.4 25 41.4 27 V38.2 Z" fill="url(#ph-steel)" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
  <rect x="35.6" y="27.4" width="4.2" height="4.4" rx="1" fill="#1b2a36" stroke="${INK}" stroke-width="1"/>
  <rect x="36.4" y="28.4" width="2.6" height="2.4" rx="0.6" fill="url(#ph-core)"/>
  <circle cx="37.8" cy="34.8" r="1.2" fill="url(#ph-bronze)" stroke="${INK}" stroke-width="0.8"/>
  <path d="M8.2 38.2 V17.8 Q8.2 11.4 14.6 11.4 H25.4 Q31.8 11.4 31.8 17.8 V38.2 Z" fill="url(#ph-steel)" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round"/>
  <rect x="8.2" y="20.4" width="23.6" height="11" fill="#1b2a36" stroke="${INK}" stroke-width="1.4"/>
  <rect x="9.6" y="21.8" width="20.8" height="8.2" rx="1.2" fill="url(#ph-core)"/>
  <path d="M22.6 22.4 L16.8 27.4 H20.6 L18.8 30 L25.4 24.4 H21.6 Z" fill="#0e2f36" fill-opacity="0.72"/>
  <path d="M11.4 15 H21" stroke="#f6faff" stroke-opacity="0.7" stroke-width="1" stroke-linecap="round"/>
  <rect x="9.6" y="34" width="20.8" height="2.6" rx="1.3" fill="url(#ph-bronze)" stroke="${INK}" stroke-width="1.1"/>
</symbol>

<symbol id="ph-i-node" viewBox="0 0 48 48">
  <path d="M8.4 43.2 H39.6 Q41.4 43.2 41 41.6 L40.2 38.2 H7.8 L7 41.6 Q6.6 43.2 8.4 43.2 Z" fill="url(#ph-steel-dark)" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M19.4 38.2 L21.6 13 H26.4 L28.6 38.2 Z" fill="url(#ph-steel)" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round"/>
  <rect x="21.2" y="26.6" width="5.6" height="2.4" rx="1" fill="url(#ph-bronze)" stroke="${INK}" stroke-width="0.9"/>
  <rect x="21.4" y="20.4" width="5.2" height="2.2" rx="1" fill="url(#ph-bronze)" stroke="${INK}" stroke-width="0.9"/>
  <rect x="13.2" y="29.6" width="21.6" height="4" rx="2" fill="url(#ph-steel-dark)" stroke="${INK}" stroke-width="1.5"/>
  <rect x="15.6" y="23" width="16.8" height="3.8" rx="1.9" fill="url(#ph-steel-dark)" stroke="${INK}" stroke-width="1.5"/>
  <rect x="18" y="17" width="12" height="3.6" rx="1.8" fill="url(#ph-steel-dark)" stroke="${INK}" stroke-width="1.5"/>
  <rect x="12.6" y="35.6" width="22.8" height="2.6" rx="1.3" fill="url(#ph-bronze)" stroke="${INK}" stroke-width="1.1"/>
  <path d="M24 2.4 L29.2 8.4 L24 14.4 L18.8 8.4 Z" fill="url(#ph-core)" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M21.8 7.8 L24 5.2" stroke="#ffffff" stroke-opacity="0.85" stroke-width="1.4" stroke-linecap="round"/>
  <path d="M15.6 31.6 H20.4" stroke="#f6faff" stroke-opacity="0.6" stroke-width="1" stroke-linecap="round"/>
</symbol>

<symbol id="ph-i-storage" viewBox="0 0 48 48">
  <path d="M8.4 43.2 H39.6 Q41.4 43.2 41 41.6 L40.2 38.2 H7.8 L7 41.6 Q6.6 43.2 8.4 43.2 Z" fill="url(#ph-steel-dark)" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
  <rect x="7" y="12.4" width="34" height="25.8" rx="2.8" fill="url(#ph-steel)" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round"/>
  <rect x="7" y="12.4" width="34" height="5.2" rx="2.8" fill="url(#ph-steel-dark)" stroke="${INK}" stroke-width="1.5"/>
  <path d="M13.4 20.6 V35.6 M18.2 20.6 V35.6 M29.8 20.6 V35.6 M34.6 20.6 V35.6" stroke="${INK}" stroke-opacity="0.42" stroke-width="1.4" stroke-linecap="round"/>
  <rect x="20.4" y="20.2" width="7.2" height="15.4" rx="1.4" fill="#1b2a36" stroke="${INK}" stroke-width="1.3"/>
  <rect x="21.8" y="22" width="4.4" height="2.4" rx="1" fill="url(#ph-core)"/>
  <rect x="22.2" y="29" width="3.6" height="1.8" rx="0.9" fill="url(#ph-bronze)" stroke="${INK}" stroke-width="0.8"/>
  <rect x="8.4" y="32.6" width="3.8" height="3.8" rx="0.8" fill="url(#ph-bronze)" stroke="${INK}" stroke-width="1"/>
  <rect x="35.8" y="32.6" width="3.8" height="3.8" rx="0.8" fill="url(#ph-bronze)" stroke="${INK}" stroke-width="1"/>
  <path d="M10.6 15.2 H21" stroke="#f6faff" stroke-opacity="0.7" stroke-width="1" stroke-linecap="round"/>
</symbol>

<symbol id="ph-i-bed" viewBox="0 0 48 48">
  <rect x="6.4" y="38.6" width="4.2" height="4.6" rx="0.9" fill="url(#ph-bronze)" stroke="${INK}" stroke-width="1.1"/>
  <rect x="37.4" y="38.6" width="4.2" height="4.6" rx="0.9" fill="url(#ph-bronze)" stroke="${INK}" stroke-width="1.1"/>
  <rect x="4.6" y="13.4" width="5.2" height="26.2" rx="1.6" fill="url(#ph-steel-dark)" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
  <rect x="38.4" y="26.2" width="5" height="13.4" rx="1.6" fill="url(#ph-steel-dark)" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
  <rect x="8.4" y="30.6" width="31.6" height="5.4" rx="1.4" fill="url(#ph-steel-dark)" stroke="${INK}" stroke-width="1.6"/>
  <rect x="8.6" y="23.6" width="31.2" height="8" rx="3" fill="url(#ph-steel)" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M19.6 22.6 H38.4 Q40 22.6 40 24.2 V30.6 H19.6 Z" fill="url(#ph-bronze)" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M24.6 24 V30 M29.4 24 V30" stroke="${INK}" stroke-opacity="0.35" stroke-width="1.2" stroke-linecap="round"/>
  <rect x="10.6" y="19.6" width="9" height="4.6" rx="2.3" fill="#e4eef6" stroke="${INK}" stroke-width="1.4"/>
  <rect x="5.8" y="16.2" width="2.8" height="5" rx="1.1" fill="url(#ph-core)"/>
  <path d="M12.6 21 H17.4" stroke="#ffffff" stroke-opacity="0.7" stroke-width="1" stroke-linecap="round"/>
</symbol>

<symbol id="ph-i-light" viewBox="0 0 48 48">
  <path d="M8.4 43.2 H39.6 Q41.4 43.2 41 41.6 L40.2 38.2 H7.8 L7 41.6 Q6.6 43.2 8.4 43.2 Z" fill="url(#ph-steel-dark)" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M21.8 38.2 L22.8 11 H26.2 L27.2 38.2 Z" fill="url(#ph-steel)" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round"/>
  <rect x="21.2" y="30.4" width="5.6" height="2.6" rx="1" fill="url(#ph-bronze)" stroke="${INK}" stroke-width="0.9"/>
  <rect x="12.6" y="35.6" width="22.8" height="2.6" rx="1.3" fill="url(#ph-bronze)" stroke="${INK}" stroke-width="1.1"/>
  <path d="M10 12.4 Q10 4 24 4 Q38 4 38 12.4 Z" fill="url(#ph-steel-dark)" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round"/>
  <ellipse cx="24" cy="12.9" rx="12.6" ry="3" fill="url(#ph-sun)" stroke="${INK}" stroke-width="1.4"/>
  <path d="M14.4 18.4 L11.8 23.4 M19 18.4 L17.6 24 M29 18.4 L30.4 24 M33.6 18.4 L36.2 23.4" stroke="#ffd36a" stroke-opacity="0.8" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M14 7.6 Q17 5.6 21 5.4" stroke="#f6faff" stroke-opacity="0.7" stroke-width="1" stroke-linecap="round" fill="none"/>
</symbol>
${BLOCK_SYMBOLS}
${SHAPE_SYMBOLS}
`;

/** The hidden sprite sheet; add it once to the page, before any `iconMarkup`. */
export const ICON_SPRITE = `<svg class="ph-sprite" width="0" height="0" aria-hidden="true" focusable="false">${SPRITE_BODY}</svg>`;

/** Markup for one icon; the element takes its size from CSS. */
export function iconMarkup(id: IconId): string {
  return `<svg class="ph-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><use href="#ph-i-${id}"/></svg>`;
}
