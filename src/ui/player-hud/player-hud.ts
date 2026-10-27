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
import { ResearchLadder, type HudLadder } from './research-ladder';
import './player-hud.css';

export type { HudLadder, HudLadderRow } from './research-ladder';

/** One slot of the hotbar. Everything but the icon is optional. */
export interface HotbarSlot {
  readonly icon: IconId | null;
  /** Stack size shown bottom right; a stack of one shows nothing. */
  readonly count?: number;
  /** How much of this slot's material the crew's pool holds, shown bottom right even at 0 or 1 (a stack that is out is dimmed). */
  readonly stock?: number;
  /** The pool holds as much of this slot's material as it can, so its count is drawn in amber. */
  readonly full?: boolean;
  /** 0 to 1, drawn as the green bar along the bottom. */
  readonly durability?: number;
  /** A small status glyph in the top right corner. */
  readonly badge?: IconId;
  /** The cyan grid of a blueprint or placeable item. */
  readonly blueprint?: boolean;
  /** Closed to the crew until it is researched: the icon is dim behind a padlock, and no count is shown. */
  readonly locked?: boolean;
}

/** The caption above the hotbar: what is in hand and what it costs, or why a click would do nothing. */
export interface HudPrompt {
  readonly title: string;
  readonly detail: string;
  /** 'warn' draws the detail in red. */
  readonly tone: 'info' | 'warn';
}

/** What the interact key would do for what the cursor is on: a key cap, a verb, and a short line under it. */
export interface HudInteract {
  /** The key, as its cap reads. */
  readonly key: string;
  /** What it does: "Strip debris". */
  readonly label: string;
  /** What is worth knowing before pressing it: "3 strips left". */
  readonly detail: string;
  /** 'warn' draws the detail in red, for a key that would be refused; absent means 'info'. */
  readonly tone?: 'info' | 'warn';
}

/** What power the module under the cursor has: a small tag under the crosshair, with a lit dot or a dim one, a word and a line of what it means for the module. */
export interface HudPowerTag {
  /** 'on' lights the dot in the Energy blue; 'off' leaves it grey. */
  readonly state: 'on' | 'off';
  /** "Powered" or "No power". */
  readonly label: string;
  /** What it means for this module: "Fires 1.5× faster". */
  readonly detail: string;
}

/**
 * How the crosshair looks: a plain dot, a cyan ring over a surface a click could build on, a red
 * one over a surface it could not, or the sight of the pulse blaster while it is in hand.
 */
export type CrosshairState = 'none' | 'place' | 'blocked' | 'blaster';

/** The marker that flashes round the crosshair when a shot hits a machine. */
export interface HudHitMarker {
  /** How many hits there have been so far: each rise flashes the marker once. */
  readonly count: number;
  /** Whether the latest hit felled its machine, which flashes it larger and hotter. */
  readonly kill: boolean;
}

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

/** The crew's respawn charges, drawn as pips in a pill under the Core's gauge. */
export interface HudCharges {
  /** Charges the crew holds now. */
  readonly count: number;
  /** The most it can hold now: a pip is drawn for each, and the ones past `count` are empty. */
  readonly max: number;
  /** How worried to look: amber at the last charge, red with none. */
  readonly tone: 'ok' | 'low' | 'empty';
}

/** The crew's research, as a pill under the respawn charges: the points earned and how far they are from the next row of the ladder. */
export interface HudResearch {
  /** The points the crew has earned. */
  readonly points: number;
  /** 0 to 1: the points as a share of the next row's, and 1 once the whole ladder is climbed. */
  readonly fraction: number;
  /** The words at the end of the pill: "12/20", or the points alone once there is no next row. */
  readonly value: string;
  /** The word in front of the bar: "Research", or "Needs Terminal" while points the crew has earned wait for one to read them. */
  readonly label: string;
  /** 'full' once the whole ladder is climbed, 'waiting' while a row the points reach is shut for want of a Terminal. */
  readonly tone: 'rising' | 'full' | 'waiting';
  /** How many times the points have risen so far: each rise flashes the pill once. */
  readonly gains: number;
}

/** What the screen says to a player who is down. */
export interface HudDown {
  readonly title: string;
  readonly detail: string;
  /** Whole seconds until the Core brings the player back, drawn large under the title; null when there is no countdown. */
  readonly seconds: number | null;
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
  /** The crew's respawn charges under the Core's gauge; absent or null hides them. */
  readonly charges?: HudCharges | null;
  /** The crew's research under the respawn charges; absent or null hides it. */
  readonly research?: HudResearch | null;
  /** The screen of a player who is down; absent or null for a player who is up. */
  readonly down?: HudDown | null;
  readonly objective: { readonly place: string; readonly title: string } | null;
  readonly slots: readonly HotbarSlot[];
  /** Index of the selected hotbar slot. */
  readonly selected: number;
  /** The caption above the hotbar; absent or null for none. */
  readonly prompt?: HudPrompt | null;
  /** What the interact key would do for what the cursor is on, under the crosshair; absent or null for nothing. */
  readonly interact?: HudInteract | null;
  /** Whether the turret or Power Node the cursor is on has power, in a tag under the crosshair (below the interact card when that is up); absent or null for none. */
  readonly powerTag?: HudPowerTag | null;
  /** The research ladder of the Research Terminal the player has opened, beside the crosshair; absent or null for none. */
  readonly ladder?: HudLadder | null;
  /** Absent means a plain dot. */
  readonly crosshair?: CrosshairState;
  /** The hit marker; absent never flashes it. */
  readonly hitMarker?: HudHitMarker;
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
  readonly lock: HTMLElement;
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
  private readonly gauges: HTMLElement;
  private readonly core: HTMLElement;
  private readonly coreValue: HTMLElement;
  private readonly coreFill: HTMLElement;
  private readonly charges: HTMLElement;
  private readonly chargePips: HTMLElement;
  private readonly chargeValue: HTMLElement;
  private readonly research: HTMLElement;
  private readonly researchFill: HTMLElement;
  private readonly researchLabel: HTMLElement;
  private readonly researchValue: HTMLElement;
  private readonly down: HTMLElement;
  private readonly downTitle: HTMLElement;
  private readonly downDetail: HTMLElement;
  private readonly downSeconds: HTMLElement;
  private readonly objective: HTMLElement;
  private readonly objectivePlace: HTMLElement;
  private readonly objectiveTitle: HTMLElement;
  private readonly slots: SlotRefs[] = [];
  private readonly prompt: HTMLElement;
  private readonly promptTitle: HTMLElement;
  private readonly promptDetail: HTMLElement;
  private readonly interact: HTMLElement;
  private readonly interactKey: HTMLElement;
  private readonly interactLabel: HTMLElement;
  private readonly interactDetail: HTMLElement;
  private readonly powerTag: HTMLElement;
  private readonly powerTagLabel: HTMLElement;
  private readonly powerTagDetail: HTMLElement;
  private readonly ladder: ResearchLadder;
  private readonly crosshair: HTMLElement;
  private readonly hitmark: HTMLElement;
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
  private lastCharges = '';
  private lastChargeCount = Number.NaN;
  private chargeHits = 0;
  private lastResearch = '';
  private lastResearchGains = -1;
  private researchHits = 0;
  private lastDown = '';
  private lastObjective = '';
  private readonly lastSlots: string[] = [];
  private lastSelected = -1;
  private lastPrompt = '';
  private lastInteract = '';
  private lastPowerTag = '';
  private lastCrosshair = '';
  private lastHits = -1;
  private hitTurns = 0;
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

    // The crew's respawn charges, a pill of pips under the Core's gauge. The two sit in one column
    // so the pill under whichever is showing never moves.
    this.charges = el('div', 'ph-charges');
    this.charges.hidden = true;
    const chargeIcon = el('span', 'ph-charges-icon');
    chargeIcon.innerHTML = iconMarkup('heart');
    this.chargePips = el('span', 'ph-charges-pips');
    this.chargeValue = el('span', 'ph-charges-value');
    this.charges.append(
      chargeIcon,
      el('span', 'ph-charges-label', 'Respawns'),
      this.chargePips,
      this.chargeValue,
    );

    // The crew's research, a third pill in the same column: on screen while building and for a while after the points change.
    this.research = el('div', 'ph-research');
    this.research.hidden = true;
    const researchIcon = el('span', 'ph-research-icon');
    researchIcon.innerHTML = iconMarkup('research');
    const researchTrack = el('i', 'ph-research-track');
    this.researchFill = el('i', 'ph-research-fill');
    researchTrack.append(this.researchFill);
    this.researchLabel = el('span', 'ph-research-label', 'Research');
    this.researchValue = el('span', 'ph-research-value');
    this.research.append(researchIcon, this.researchLabel, researchTrack, this.researchValue);
    this.gauges = el('div', 'ph-gauges');
    this.gauges.append(this.core, this.charges, this.research);

    // What a player who is down sees: the edges of the screen darken, and the Core's countdown.
    this.down = el('div', 'ph-down');
    this.down.hidden = true;
    this.downTitle = el('strong', 'ph-down-title');
    this.downDetail = el('span', 'ph-down-detail');
    this.downSeconds = el('b', 'ph-down-seconds');
    this.down.append(this.downTitle, this.downDetail, this.downSeconds);

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

    // What the interact key would do, under the crosshair.
    this.interact = el('div', 'ph-interact');
    this.interact.hidden = true;
    this.interactKey = el('kbd', 'ph-key');
    this.interactLabel = el('strong', 'ph-interact-label');
    this.interactDetail = el('span', 'ph-interact-detail');
    this.interact.append(this.interactKey, this.interactLabel, this.interactDetail);

    // Whether the turret or Power Node under the crosshair has power: a tag after the card above, so it sits under it when both are up.
    this.powerTag = el('div', 'ph-power-tag');
    this.powerTag.hidden = true;
    this.powerTagLabel = el('strong', 'ph-power-tag-label');
    this.powerTagDetail = el('span', 'ph-power-tag-detail');
    this.powerTag.append(el('i', 'ph-power-tag-dot'), this.powerTagLabel, this.powerTagDetail);

    // The research ladder a Terminal shows, beside the crosshair.
    this.ladder = new ResearchLadder();

    this.crosshair = el('div', 'ph-crosshair');
    // Four ticks that flash round the crosshair on a hit; they sit inside it so they are always centered.
    this.hitmark = el('div', 'ph-hitmark');
    for (let i = 0; i < 4; i++) this.hitmark.append(el('i'));
    this.crosshair.append(this.hitmark);
    this.root.append(
      this.hurt,
      this.down,
      vitals,
      this.statusColumn,
      compass,
      this.clock,
      this.gauges,
      this.objective,
      this.prompt,
      bar,
      this.interact,
      this.powerTag,
      this.ladder.root,
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
    const lock = el('div', 'ph-slot-lock');
    lock.hidden = true;
    lock.innerHTML = iconMarkup('lock');
    const durability = el('div', 'ph-dur');
    const durabilityFill = el('i');
    durability.append(durabilityFill);
    const count = el('span', 'ph-count');
    root.append(icon, badge, lock, durability, count);
    parent.append(root);
    return { root, icon, count, badge, lock, durability, durabilityFill };
  }

  update(state: PlayerHudState): void {
    this.updateVitals(state);
    this.updateStatuses(state);
    this.updateCompass(state);
    this.updateClock(state);
    this.updateCore(state);
    this.updateCharges(state);
    this.updateResearch(state);
    this.updateDown(state);
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

  private updateCharges(state: PlayerHudState): void {
    const charges = state.charges ?? null;
    const key = charges ? `${charges.tone}|${charges.count}|${charges.max}` : '';
    if (key === this.lastCharges) return;
    this.lastCharges = key;
    this.charges.hidden = charges === null;
    if (!charges) {
      this.lastChargeCount = Number.NaN;
      return;
    }
    this.charges.dataset.tone = charges.tone;
    this.chargeValue.textContent = String(charges.count);
    const pips = this.chargePips;
    while (pips.children.length < charges.max) pips.append(el('i'));
    while (pips.children.length > charges.max) pips.lastElementChild?.remove();
    Array.from(pips.children).forEach((pip, i) =>
      pip.toggleAttribute('data-full', i < charges.count),
    );
    // A charge spent flashes the pill. Two animations take turns, because setting the one that
    // is already running would not restart it.
    if (charges.count < this.lastChargeCount) {
      this.charges.dataset.hit = String(++this.chargeHits % 2);
    }
    this.lastChargeCount = charges.count;
  }

  private updateResearch(state: PlayerHudState): void {
    const research = state.research ?? null;
    const fill = research ? Math.round(clamp01(research.fraction) * 1000) / 10 : -1;
    const key = research
      ? `${research.tone}|${research.label}|${research.value}|${fill}|${research.gains}`
      : '';
    if (key === this.lastResearch) return;
    this.lastResearch = key;
    this.research.hidden = research === null;
    if (!research) return;
    this.research.dataset.tone = research.tone;
    this.researchLabel.textContent = research.label;
    this.researchValue.textContent = research.value;
    this.researchFill.style.width = `${fill}%`;
    // Points earned flash the pill. Two animations take turns, because setting the one that is
    // already running would not restart it. The first look is not a gain: the pill just came up.
    if (this.lastResearchGains >= 0 && research.gains > this.lastResearchGains) {
      this.research.dataset.hit = String(++this.researchHits % 2);
    }
    this.lastResearchGains = research.gains;
  }

  private updateDown(state: PlayerHudState): void {
    const down = state.down ?? null;
    const key = down ? `${down.title}|${down.detail}|${down.seconds ?? ''}` : '';
    if (key === this.lastDown) return;
    this.lastDown = key;
    this.down.hidden = down === null;
    this.root.toggleAttribute('data-down', down !== null);
    if (!down) return;
    this.downTitle.textContent = down.title;
    this.downDetail.textContent = down.detail;
    this.downSeconds.hidden = down.seconds === null;
    this.downSeconds.textContent = down.seconds === null ? '' : String(down.seconds);
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
      const locked = slot.locked === true;
      const key = `${slot.icon ?? ''}|${slot.count ?? ''}|${slot.stock ?? ''}|${slot.badge ?? ''}|${
        slot.blueprint ? 1 : 0
      }|${locked ? 1 : 0}|${slot.full ? 1 : 0}|${
        slot.durability === undefined ? '' : slot.durability.toFixed(2)
      }`;
      if (key === this.lastSlots[i]) return;
      this.lastSlots[i] = key;
      refs.icon.innerHTML = slot.icon ? iconMarkup(slot.icon) : '';
      refs.badge.innerHTML = slot.badge ? iconMarkup(slot.badge) : '';
      // A pool's count is always told, down to none; a stack is told only when there is more than one.
      // A slot that is closed tells no count: the padlock is the news.
      refs.count.textContent = locked
        ? ''
        : slot.stock !== undefined
          ? String(slot.stock)
          : slot.count && slot.count > 1
            ? String(slot.count)
            : '';
      refs.count.toggleAttribute('data-none', !locked && slot.stock === 0);
      refs.count.toggleAttribute('data-full', !locked && slot.full === true);
      refs.lock.hidden = !locked;
      refs.root.toggleAttribute('data-locked', locked);
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
    const interact = state.interact ?? null;
    const interactKey = interact
      ? `${interact.key}|${interact.label}|${interact.detail}|${interact.tone ?? 'info'}`
      : '';
    if (interactKey !== this.lastInteract) {
      this.lastInteract = interactKey;
      this.interact.hidden = interact === null;
      if (interact) {
        this.interactKey.textContent = interact.key;
        this.interactLabel.textContent = interact.label;
        this.interactDetail.textContent = interact.detail;
        this.interact.dataset.tone = interact.tone ?? 'info';
      }
    }
    const tag = state.powerTag ?? null;
    const tagKey = tag ? `${tag.state}|${tag.label}|${tag.detail}` : '';
    if (tagKey !== this.lastPowerTag) {
      this.lastPowerTag = tagKey;
      this.powerTag.hidden = tag === null;
      if (tag) {
        this.powerTagLabel.textContent = tag.label;
        this.powerTagDetail.textContent = tag.detail;
        this.powerTag.dataset.state = tag.state;
      }
    }
    this.ladder.update(state.ladder ?? null);
    const crosshair = state.crosshair ?? 'none';
    if (crosshair !== this.lastCrosshair) {
      this.lastCrosshair = crosshair;
      this.crosshair.dataset.state = crosshair;
    }
    // A hit flashes the marker. Two animations take turns, because setting the one that is
    // already running would not restart it. The first look is not a hit: the page just opened.
    const hits = state.hitMarker;
    if (hits) {
      if (this.lastHits >= 0 && hits.count > this.lastHits) {
        this.hitmark.toggleAttribute('data-kill', hits.kill);
        this.hitmark.dataset.hit = String(++this.hitTurns % 2);
      }
      this.lastHits = hits.count;
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
