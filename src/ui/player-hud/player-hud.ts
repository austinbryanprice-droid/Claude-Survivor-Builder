import { el } from '../dom';
import {
  cardinalLabel,
  clamp01,
  formatClock,
  formatDistance,
  hudScale,
  relativeBearing,
  segmentFills,
} from './format';
import { ICON_SPRITE, iconMarkup, type IconId } from './icons';
import './player-hud.css';

/** One slot of the hotbar. Everything but the icon is optional. */
export interface HotbarSlot {
  readonly icon: IconId | null;
  /** Stack size shown bottom right. */
  readonly count?: number;
  /** 0 to 1, drawn as the green bar along the bottom. */
  readonly durability?: number;
  /** A small status glyph in the top right corner. */
  readonly badge?: IconId;
  /** The cyan grid of a blueprint or placeable item. */
  readonly blueprint?: boolean;
}

/** The caption above the hotbar: what is in hand and what it costs, or why a click would do nothing. */
export interface HudPrompt {
  readonly title: string;
  readonly detail: string;
  /** 'warn' draws the detail in red. */
  readonly tone: 'info' | 'warn';
}

/** How the crosshair looks: a plain dot, a cyan ring over a surface a click could build on, a red one over a surface it could not. */
export type CrosshairState = 'none' | 'place' | 'blocked';

/** A marker on the compass, such as a quest destination. */
export interface HudWaypoint {
  /** Compass bearing in degrees (0 north, 90 east). */
  readonly bearing: number;
  /** Distance in meters, shown above the marker. */
  readonly distance: number;
}

/** The day and night clock by the compass. */
export interface HudClock {
  readonly phase: 'day' | 'night';
  /** "Day 2" or "Night 2". */
  readonly label: string;
  /** Time left until the light changes, as "5:12". */
  readonly time: string;
  /** 0 to 1: how far through the day or the night. */
  readonly progress: number;
  /** The light is about to change. */
  readonly soon: boolean;
}

/** The Outpost Core's gauge under the clock. */
export interface HudCore {
  /** 0 to 1: how much of its health is left. */
  readonly fraction: number;
  /** The health left, in points, as it is read out. */
  readonly value: string;
  /** How worried to look: cyan while sound, amber when worn, red when critical, grey once fallen. */
  readonly tone: 'sound' | 'worn' | 'critical' | 'fallen';
}

/** One round status icon under the bars, with the words beside it. */
export interface HudStatus {
  readonly icon: IconId;
  /** The words beside the icon, such as "Charging". */
  readonly label: string;
  /** Seconds left, shown after the label as "0:52"; absent for a status that lasts as long as its cause. */
  readonly seconds?: number;
  /** 'good' is the green circle with an arrow up, 'bad' the amber one with an arrow down. */
  readonly tone: 'good' | 'bad';
}

export interface PlayerHudState {
  /** 0 to 1. */
  readonly health: number;
  /** 'low' turns the bar red; absent is 'ok'. */
  readonly healthTone?: 'ok' | 'low';
  /** Number of segments the health bar is divided into. */
  readonly healthSegments: number;
  /** 0 to 1: the slim bar under the health. */
  readonly energy: number;
  /** 'low' turns the bar amber and 'empty' makes its frame breathe; absent is 'ok'. */
  readonly energyTone?: 'ok' | 'low' | 'empty';
  /** Round status icons under the bars, top to bottom. */
  readonly statuses: readonly HudStatus[];
  /** Which way the player faces, as a compass bearing in degrees. */
  readonly heading: number;
  readonly waypoints: readonly HudWaypoint[];
  /** The day and night clock under the compass; absent or null hides it. */
  readonly clock?: HudClock | null;
  /** The Outpost Core's gauge under the clock; absent or null hides it. */
  readonly core?: HudCore | null;
  readonly objective: { readonly place: string; readonly title: string } | null;
  readonly slots: readonly HotbarSlot[];
  /** Index of the selected hotbar slot. */
  readonly selected: number;
  /** The caption above the hotbar; absent or null for none. */
  readonly prompt?: HudPrompt | null;
  /** Absent means a plain dot. */
  readonly crosshair?: CrosshairState;
  /** Build Mode is on: the Build hint lights up and the crosshair gets its ring. */
  readonly buildMode?: boolean;
}

/** Degrees of compass visible at once. */
const COMPASS_SPAN = 222;
/** The strip repeats the 360 degrees three times so it can wrap without a seam. */
const STRIP_SPAN = 1080;
/** A tick at every cardinal and intercardinal direction. */
const TICK_STEP = 45;
/** At most this many waypoints are drawn at once. */
const MAX_WAYPOINTS = 4;
/** A drop in health smaller than this share of the bar is rounding, not a wound. */
const HURT_EPSILON = 0.0005;

const ROUGH_FILTER = /* html */ `
<svg class="ph-sprite" width="0" height="0" aria-hidden="true" focusable="false">
  <filter id="ph-rough" x="-4%" y="-40%" width="108%" height="180%">
    <feTurbulence type="fractalNoise" baseFrequency="0.03 0.14" numOctaves="2" seed="11" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="3.4" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
</svg>`;

interface SlotRefs {
  readonly root: HTMLElement;
  readonly icon: HTMLElement;
  readonly count: HTMLElement;
  readonly badge: HTMLElement;
  readonly durability: HTMLElement;
  readonly durabilityFill: HTMLElement;
}

interface WaypointRefs {
  readonly root: HTMLElement;
  readonly distance: HTMLElement;
}

/**
 * The in-game HUD, after the Enshrouded reference: segmented health and Energy bars in torn
 * dark frames, round status icons, a compass strip with a quest marker, an objective banner and
 * an eight-slot hotbar. It is a pure view: `update` takes the whole state and touches the DOM
 * only where something changed.
 */
export class PlayerHud {
  readonly root: HTMLElement;

  private readonly hurt: HTMLElement;
  private readonly health: HTMLElement;
  private readonly healthFills: HTMLElement[] = [];
  private readonly energy: HTMLElement;
  private readonly energyFill: HTMLElement;
  private readonly statusColumn: HTMLElement;
  private readonly strip: HTMLElement;
  private readonly waypointLayer: HTMLElement;
  private readonly waypoints: WaypointRefs[] = [];
  private readonly clock: HTMLElement;
  private readonly clockIcon: HTMLElement;
  private readonly clockLabel: HTMLElement;
  private readonly clockTime: HTMLElement;
  private readonly clockFill: HTMLElement;
  private readonly core: HTMLElement;
  private readonly coreValue: HTMLElement;
  private readonly coreFill: HTMLElement;
  private readonly objective: HTMLElement;
  private readonly objectivePlace: HTMLElement;
  private readonly objectiveTitle: HTMLElement;
  private readonly slots: SlotRefs[] = [];
  private readonly prompt: HTMLElement;
  private readonly promptTitle: HTMLElement;
  private readonly promptDetail: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly buildHint: HTMLElement;
  private readonly stopResize: () => void;

  private lastHealth = '';
  private lastHealthFraction = Number.NaN;
  private lastHealthTone = '';
  private healthHits = 0;
  private lastEnergy = -1;
  private lastEnergyTone = '';
  private lastStatuses = '';
  private lastHeading = Number.NaN;
  private lastClock = '';
  private lastClockFill = -1;
  private lastCore = '';
  private lastCorePoints = Number.NaN;
  private coreHits = 0;
  private lastObjective = '';
  private readonly lastSlots: string[] = [];
  private lastSelected = -1;
  private lastPrompt = '';
  private lastCrosshair = '';
  private lastBuildMode: boolean | null = null;

  constructor(parent: HTMLElement, segments = 3) {
    this.root = el('div', 'ph');
    this.root.setAttribute('aria-hidden', 'true');
    this.root.insertAdjacentHTML('beforeend', ICON_SPRITE + ROUGH_FILTER);

    // A wound reddens the edges of the screen for a moment.
    this.hurt = el('div', 'ph-hurt');

    // Vitals: health in segments over a shorter Energy bar, in one torn frame.
    const vitals = el('div', 'ph-vitals');
    this.health = el('div', 'ph-frame ph-health');
    for (let i = 0; i < segments; i++) {
      const segment = el('div', 'ph-seg');
      const fill = el('i', 'ph-fill');
      segment.append(fill);
      this.health.append(segment);
      this.healthFills.push(fill);
    }
    this.energy = el('div', 'ph-frame ph-energy');
    this.energyFill = el('i', 'ph-energy-fill');
    this.energyFill.append(el('b', 'ph-cap'));
    this.energy.append(this.energyFill);
    vitals.append(this.health, this.energy);

    this.statusColumn = el('div', 'ph-statuses');

    // Compass: a strip of ticks that slides under a fixed window, plus waypoint markers.
    const compass = el('div', 'ph-compass');
    const compassWindow = el('div', 'ph-compass-window');
    this.strip = el('div', 'ph-compass-strip');
    this.strip.style.width = `${((STRIP_SPAN / COMPASS_SPAN) * 100).toFixed(3)}%`;
    this.buildTicks();
    compassWindow.append(this.strip);
    this.waypointLayer = el('div', 'ph-compass-waypoints');
    compass.append(compassWindow, el('div', 'ph-compass-line'), this.waypointLayer);

    // The day and night clock, a small pill under the compass.
    this.clock = el('div', 'ph-clock');
    this.clock.hidden = true;
    this.clockIcon = el('span', 'ph-clock-icon');
    this.clockLabel = el('span', 'ph-clock-label');
    this.clockTime = el('span', 'ph-clock-time');
    const track = el('i', 'ph-clock-track');
    this.clockFill = el('i', 'ph-clock-fill');
    track.append(this.clockFill);
    this.clock.append(this.clockIcon, this.clockLabel, this.clockTime, track);

    // The Outpost Core's gauge, a second pill under the clock.
    this.core = el('div', 'ph-core');
    this.core.hidden = true;
    const coreIcon = el('span', 'ph-core-icon');
    coreIcon.innerHTML = iconMarkup('core');
    const coreTrack = el('i', 'ph-core-track');
    this.coreFill = el('i', 'ph-core-fill');
    coreTrack.append(this.coreFill);
    this.coreValue = el('span', 'ph-core-value');
    this.core.append(coreIcon, el('span', 'ph-core-label', 'Core'), coreTrack, this.coreValue);

    // Objective banner and the journal hint under it.
    this.objective = el('div', 'ph-objective');
    const banner = el('div', 'ph-banner');
    const text = el('div', 'ph-banner-text');
    this.objectivePlace = el('small', 'ph-banner-place');
    this.objectiveTitle = el('strong', 'ph-banner-title');
    text.append(this.objectivePlace, this.objectiveTitle);
    const emblem = el('div', 'ph-emblem');
    emblem.innerHTML = iconMarkup('spire');
    banner.append(text, emblem);
    const journal = el('div', 'ph-journal');
    journal.append(el('span', undefined, 'Journal'), el('kbd', 'ph-key', 'J'));
    this.objective.append(banner, journal);

    // Hotbar.
    const bar = el('div', 'ph-hotbar');
    const hint = el('div', 'ph-hotbar-hint');
    hint.append(el('kbd', 'ph-key', 'ALT'));
    this.buildHint = el('div', 'ph-hotbar-hint ph-build-hint');
    this.buildHint.append(el('kbd', 'ph-key', 'B'), el('span', undefined, 'Build'));
    const row = el('div', 'ph-hotbar-row');
    for (let i = 0; i < 8; i++) this.slots.push(this.buildSlot(row, i));
    bar.append(hint, row, this.buildHint);

    // The caption above the hotbar.
    this.prompt = el('div', 'ph-prompt');
    this.prompt.hidden = true;
    this.promptTitle = el('strong', 'ph-prompt-title');
    this.promptDetail = el('span', 'ph-prompt-detail');
    this.prompt.append(this.promptTitle, this.promptDetail);

    this.crosshair = el('div', 'ph-crosshair');
    this.root.append(
      this.hurt,
      vitals,
      this.statusColumn,
      compass,
      this.clock,
      this.core,
      this.objective,
      this.prompt,
      bar,
      this.crosshair,
    );
    parent.append(this.root);

    const rescale = (): void => {
      this.root.style.setProperty(
        '--u',
        hudScale(window.innerWidth, window.innerHeight).toFixed(3),
      );
    };
    rescale();
    window.addEventListener('resize', rescale);
    this.stopResize = () => window.removeEventListener('resize', rescale);
  }

  private buildTicks(): void {
    for (let deg = -360; deg < 720; deg += TICK_STEP) {
      const label = cardinalLabel(deg);
      const tick = el(
        'div',
        label ? (label === 'N' ? 'ph-tick ph-tick-north' : 'ph-tick ph-tick-letter') : 'ph-tick',
      );
      tick.style.left = `${(((deg + 360) / STRIP_SPAN) * 100).toFixed(4)}%`;
      if (label) tick.append(el('span', 'ph-tick-label', label));
      this.strip.append(tick);
    }
  }

  private buildSlot(parent: HTMLElement, index: number): SlotRefs {
    const root = el('div', 'ph-slot');
    root.append(el('span', 'ph-slot-key', String(index + 1)));
    const icon = el('div', 'ph-slot-icon');
    const badge = el('div', 'ph-slot-badge');
    const durability = el('div', 'ph-dur');
    const durabilityFill = el('i');
    durability.append(durabilityFill);
    const count = el('span', 'ph-count');
    root.append(icon, badge, durability, count);
    parent.append(root);
    return { root, icon, count, badge, durability, durabilityFill };
  }

  update(state: PlayerHudState): void {
    this.updateVitals(state);
    this.updateStatuses(state);
    this.updateCompass(state);
    this.updateClock(state);
    this.updateCore(state);
    this.updateObjective(state);
    this.updateHotbar(state);
    this.updateBuild(state);
  }

  private updateVitals(state: PlayerHudState): void {
    const fills = segmentFills(state.health, this.healthFills.length);
    const key = fills.map((f) => f.toFixed(3)).join(',');
    if (key !== this.lastHealth) {
      this.lastHealth = key;
      fills.forEach((f, i) => {
        const fill = this.healthFills[i];
        if (fill) fill.style.width = `${(f * 100).toFixed(2)}%`;
      });
    }
    const tone = state.healthTone ?? 'ok';
    if (tone !== this.lastHealthTone) {
      this.lastHealthTone = tone;
      this.health.dataset.tone = tone;
    }
    // A wound flashes the bar and the edges of the screen. Each has two animations that take turns,
    // because setting the one that is already running would not restart it.
    const health = clamp01(state.health);
    if (health < this.lastHealthFraction - HURT_EPSILON) {
      const turn = String(++this.healthHits % 2);
      this.health.dataset.hit = turn;
      this.hurt.dataset.hit = turn;
    }
    this.lastHealthFraction = health;

    const energy = clamp01(state.energy);
    if (Math.abs(energy - this.lastEnergy) > 0.002) {
      this.lastEnergy = energy;
      this.energyFill.style.width = `${(energy * 100).toFixed(2)}%`;
    }
    const energyTone = state.energyTone ?? 'ok';
    if (energyTone !== this.lastEnergyTone) {
      this.lastEnergyTone = energyTone;
      this.energy.dataset.tone = energyTone;
    }
  }

  private updateStatuses(state: PlayerHudState): void {
    const words = (status: HudStatus): string =>
      status.seconds === undefined
        ? status.label
        : `${status.label} ${formatClock(status.seconds)}`;
    const key = state.statuses
      .map((status) => `${status.icon}|${status.tone}|${words(status)}`)
      .join(',');
    if (key === this.lastStatuses) return;
    this.lastStatuses = key;
    this.statusColumn.replaceChildren(
      ...state.statuses.map((status) => {
        const row = el('div', 'ph-status-row');
        const circle = el('div', 'ph-status');
        circle.dataset.tone = status.tone;
        circle.innerHTML = iconMarkup(status.icon);
        const label = el('span', 'ph-status-label');
        label.dataset.tone = status.tone;
        label.append(el('span', 'ph-status-arrow'), el('span', undefined, words(status)));
        row.append(circle, label);
        return row;
      }),
    );
  }

  private updateCompass(state: PlayerHudState): void {
    const heading = Math.round(state.heading * 10) / 10;
    const moved = heading !== this.lastHeading;
    if (moved) {
      this.lastHeading = heading;
      const wrapped = ((heading % 360) + 360) % 360;
      this.strip.style.transform = `translateX(-${(((wrapped + 360) / STRIP_SPAN) * 100).toFixed(4)}%)`;
    }
    const shown = state.waypoints.slice(0, MAX_WAYPOINTS);
    while (this.waypoints.length < shown.length) this.waypoints.push(this.buildWaypoint());
    this.waypoints.forEach((refs, i) => {
      const waypoint = shown[i];
      if (!waypoint) {
        refs.root.hidden = true;
        return;
      }
      const offset = relativeBearing(waypoint.bearing, heading);
      const visible = Math.abs(offset) <= COMPASS_SPAN / 2;
      refs.root.hidden = !visible;
      if (!visible) return;
      refs.root.style.left = `${(50 + (offset / COMPASS_SPAN) * 100).toFixed(3)}%`;
      const distance = formatDistance(waypoint.distance);
      if (refs.distance.textContent !== distance) refs.distance.textContent = distance;
    });
  }

  private buildWaypoint(): WaypointRefs {
    const root = el('div', 'ph-waypoint');
    const distance = el('span', 'ph-waypoint-distance');
    const diamond = el('div', 'ph-diamond');
    diamond.append(el('span', undefined, '!'));
    root.append(distance, diamond);
    this.waypointLayer.append(root);
    return { root, distance };
  }

  private updateClock(state: PlayerHudState): void {
    const clock = state.clock ?? null;
    const key = clock ? `${clock.phase}|${clock.label}|${clock.time}|${clock.soon ? 1 : 0}` : '';
    if (key !== this.lastClock) {
      const phaseChanged = clock !== null && !this.lastClock.startsWith(`${clock.phase}|`);
      this.lastClock = key;
      this.clock.hidden = clock === null;
      if (clock) {
        this.clock.dataset.phase = clock.phase;
        this.clock.toggleAttribute('data-soon', clock.soon);
        this.clockLabel.textContent = clock.label;
        this.clockTime.textContent = clock.time;
        if (phaseChanged)
          this.clockIcon.innerHTML = iconMarkup(clock.phase === 'day' ? 'sun' : 'moon');
      }
    }
    if (clock) {
      const fill = Math.round(clamp01(clock.progress) * 1000) / 10;
      if (fill !== this.lastClockFill) {
        this.lastClockFill = fill;
        this.clockFill.style.width = `${fill}%`;
      }
    }
  }

  private updateCore(state: PlayerHudState): void {
    const core = state.core ?? null;
    const fill = core ? Math.round(clamp01(core.fraction) * 1000) / 10 : -1;
    const key = core ? `${core.tone}|${core.value}|${fill}` : '';
    if (key === this.lastCore) return;
    this.lastCore = key;
    this.core.hidden = core === null;
    if (!core) {
      this.lastCorePoints = Number.NaN;
      return;
    }
    this.core.dataset.tone = core.tone;
    this.coreValue.textContent = core.value;
    this.coreFill.style.width = `${fill}%`;
    // A loss flashes the pill. Two animations take turns, because setting the one that is already
    // running would not restart it.
    const points = Number(core.value);
    if (points < this.lastCorePoints) this.core.dataset.hit = String(++this.coreHits % 2);
    this.lastCorePoints = points;
  }

  private updateObjective(state: PlayerHudState): void {
    const key = state.objective ? `${state.objective.place}|${state.objective.title}` : '';
    if (key === this.lastObjective) return;
    this.lastObjective = key;
    this.objective.hidden = key === '';
    if (!state.objective) return;
    this.objectivePlace.textContent = state.objective.place;
    this.objectiveTitle.textContent = state.objective.title;
  }

  private updateHotbar(state: PlayerHudState): void {
    this.slots.forEach((refs, i) => {
      const slot = state.slots[i] ?? { icon: null };
      const key = `${slot.icon ?? ''}|${slot.count ?? ''}|${slot.badge ?? ''}|${slot.blueprint ? 1 : 0}|${
        slot.durability === undefined ? '' : slot.durability.toFixed(2)
      }`;
      if (key === this.lastSlots[i]) return;
      this.lastSlots[i] = key;
      refs.icon.innerHTML = slot.icon ? iconMarkup(slot.icon) : '';
      refs.badge.innerHTML = slot.badge ? iconMarkup(slot.badge) : '';
      refs.count.textContent = slot.count && slot.count > 1 ? String(slot.count) : '';
      refs.durability.hidden = slot.durability === undefined;
      if (slot.durability !== undefined) {
        refs.durabilityFill.style.width = `${(clamp01(slot.durability) * 100).toFixed(1)}%`;
      }
      refs.root.toggleAttribute('data-blueprint', slot.blueprint === true);
      refs.root.toggleAttribute('data-empty', slot.icon === null);
    });
    if (state.selected !== this.lastSelected) {
      this.lastSelected = state.selected;
      this.slots.forEach((refs, i) =>
        refs.root.toggleAttribute('data-selected', i === state.selected),
      );
    }
  }

  private updateBuild(state: PlayerHudState): void {
    const prompt = state.prompt ?? null;
    const promptKey = prompt ? `${prompt.title}|${prompt.detail}|${prompt.tone}` : '';
    if (promptKey !== this.lastPrompt) {
      this.lastPrompt = promptKey;
      this.prompt.hidden = prompt === null;
      if (prompt) {
        this.promptTitle.textContent = prompt.title;
        this.promptTitle.hidden = prompt.title === '';
        this.promptDetail.textContent = prompt.detail;
        this.prompt.dataset.tone = prompt.tone;
      }
    }
    const crosshair = state.crosshair ?? 'none';
    if (crosshair !== this.lastCrosshair) {
      this.lastCrosshair = crosshair;
      this.crosshair.dataset.state = crosshair;
    }
    const buildMode = state.buildMode === true;
    if (buildMode !== this.lastBuildMode) {
      this.lastBuildMode = buildMode;
      this.buildHint.toggleAttribute('data-active', buildMode);
      this.crosshair.toggleAttribute('data-build', buildMode);
    }
  }

  dispose(): void {
    this.stopResize();
    this.root.remove();
  }
}
