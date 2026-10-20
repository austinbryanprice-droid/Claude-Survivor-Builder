/**
 * Original pictograms for the player HUD, drawn as flat painted shapes with a dark ink edge so
 * they read on both bright and dark backgrounds. They are placeholders that stand in for the
 * real item art; ids are stable, so swapping an icon never touches the HUD code.
 *
 * All icons share one hidden SVG sprite (`ICON_SPRITE`); `iconMarkup` makes the `<svg><use>`
 * that draws one of them.
 */

export type IconId =
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
  | 'spire';

export const ICON_IDS: readonly IconId[] = [
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
];

const INK = '#1b1e25';

const SPRITE_BODY = /* html */ `
<defs>
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
  <linearGradient id="ph-glass" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#f4fbff" stop-opacity="0.85"/><stop offset="1" stop-color="#9fc7d8" stop-opacity="0.55"/>
  </linearGradient>
</defs>

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
`;

/** The hidden sprite sheet; add it once to the page, before any `iconMarkup`. */
export const ICON_SPRITE = `<svg class="ph-sprite" width="0" height="0" aria-hidden="true" focusable="false">${SPRITE_BODY}</svg>`;

/** Markup for one icon; the element takes its size from CSS. */
export function iconMarkup(id: IconId): string {
  return `<svg class="ph-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><use href="#ph-i-${id}"/></svg>`;
}
