import type { Game } from '../engine/game';
import { createBrowserSpeech, type Speech } from '../engine/speech';
import { gainOfVolume } from '../shared/audio';
import { TIME_PRESETS } from '../shared/daycycle';
import { SAMPLE_LINE, rankVoices } from '../shared/narration';
import { QUALITY_NAMES, isQualityName } from '../shared/quality';
import { SETTINGS_LIMITS } from '../shared/settings';
import { el, keycap } from './dom';
import { saveSettings } from './settings-store';

/**
 * The screen shown whenever the mouse is free: how to play, a few preferences and a big button.
 * Browsers only allow pointer lock after a click, so this doubles as the "click to play" prompt.
 */

export interface PausePanel {
  readonly element: HTMLElement;
  /** Updates the hint line (for example after the browser refused the mouse). */
  refresh(): void;
  /** Sets the line about the run ("Day 2 · 5:12 until nightfall"); null hides it. */
  setRun(line: string | null): void;
}

export interface PausePanelOptions {
  /** Offers the Time of day choice, a preview of the light at each hour for development. */
  readonly skyPreview?: boolean;
  /** Plays the intro film now (the card offers to, and keeps the choice of playing it on a new game, only when it can). */
  readonly watchIntro?: () => void;
  /** The browser's speech, for the narrator's choices; the page's own when absent, and none when null (a browser without it, a test). */
  readonly speech?: Speech | null;
}

interface Control {
  keys: string[];
  label: string;
}

const CONTROLS: Control[] = [
  { keys: ['W', 'A', 'S', 'D'], label: 'Move' },
  { keys: ['Space'], label: 'Jump (hold to keep hopping)' },
  { keys: ['Shift'], label: 'Sprint' },
  { keys: ['V', 'F5'], label: 'First or third person' },
  { keys: ['LMB', 'RMB'], label: 'Break or place; LMB fires the pulse blaster' },
  { keys: ['1–8', 'Wheel'], label: 'Choose a block, or 5 for the pulse blaster' },
  { keys: ['Q', 'R'], label: 'Block, slab or wedge; turn it' },
  {
    keys: ['E'],
    label:
      'Strip the heap of debris you are looking at, read the ladder of a Research Terminal, or upgrade a block to the next material and a turret to its next level',
  },
  { keys: ['B'], label: 'Build Mode' },
  { keys: ['P', 'F3'], label: 'Graphics preset, frame times' },
  { keys: ['Esc'], label: 'Free the mouse' },
];

const CLOCK = 'clock';
const MOMENT_LABELS: Readonly<Record<string, string>> = { golden: 'Golden hour' };
const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export function createPausePanel(
  game: Game,
  buildId: string,
  { skyPreview = false, watchIntro, speech: speechPort }: PausePanelOptions = {},
): PausePanel {
  const root = el('section', 'pause');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Paused');

  const card = el('div', 'hud-panel pause-card');
  card.append(el('p', 'kicker', 'Ashbound Outpost'));
  card.append(el('h1', undefined, 'Click to play'));
  card.append(
    el('p', 'lede', 'The valley around the crash site is yours to walk, run, climb and build on.'),
  );

  const runLine = el('p', 'run-line');
  runLine.hidden = true;
  card.append(runLine);

  const button = el('button', 'play-button', 'Play');
  button.type = 'button';
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    game.input.requestLock();
  });
  card.append(button);
  if (watchIntro) {
    const watch = el('button', 'quiet-button watch-intro', 'Watch the intro');
    watch.type = 'button';
    watch.addEventListener('click', (event) => {
      event.stopPropagation();
      watchIntro();
    });
    card.append(watch);
  }

  const hint = el('p', 'hint');
  hint.setAttribute('role', 'status');
  card.append(hint);

  const controls = el('ul', 'controls');
  for (const { keys, label } of CONTROLS) {
    const item = el('li');
    const caps = el('span', 'caps');
    keys.forEach((key) => caps.append(keycap(key)));
    item.append(caps, el('span', 'control-label', label));
    controls.append(item);
  }
  card.append(controls);

  const settingsBlock = el('div', 'settings');
  const slider = (
    label: string,
    key: 'mouseSensitivity' | 'fov' | 'volume',
    format: (value: number) => string,
  ): void => {
    const { min, max, step } = SETTINGS_LIMITS[key];
    const row = el('label', 'setting');
    const input = el('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(game.settings[key]);
    const value = el('output', undefined, format(game.settings[key]));
    input.addEventListener('input', () => {
      const next = Number(input.value);
      game.settings[key] = next;
      if (key === 'volume') game.audio.setVolume(next);
      value.textContent = format(next);
      saveSettings(game.settings);
    });
    row.append(el('span', undefined, label), input, value);
    settingsBlock.append(row);
  };
  slider('Mouse sensitivity', 'mouseSensitivity', (v) => `${v.toFixed(2)}x`);
  slider('Field of view', 'fov', (v) => `${Math.round(v)}°`);
  slider('Volume', 'volume', (v) => `${Math.round(v * 100)}%`);

  const invert = el('label', 'setting toggle');
  const invertBox = el('input');
  invertBox.type = 'checkbox';
  invertBox.checked = game.settings.invertY;
  invertBox.addEventListener('change', () => {
    game.settings.invertY = invertBox.checked;
    saveSettings(game.settings);
  });
  invert.append(invertBox, el('span', undefined, 'Invert vertical look'));
  settingsBlock.append(invert);

  /** Fills a choice with `options`, in order. */
  const setOptions = (
    select: HTMLSelectElement,
    options: readonly { value: string; label: string }[],
  ): void => {
    select.replaceChildren(
      ...options.map((option) => {
        const node = el('option', undefined, option.label);
        node.value = option.value;
        return node;
      }),
    );
  };
  const choice = (
    label: string,
    options: readonly { value: string; label: string }[],
    onPick: (value: string) => void,
  ): HTMLSelectElement => {
    const row = el('label', 'setting choice');
    const select = el('select');
    setOptions(select, options);
    select.addEventListener('change', () => onPick(select.value));
    row.append(el('span', undefined, label), select);
    settingsBlock.append(row);
    return select;
  };

  if (watchIntro) {
    const intro = el('label', 'setting toggle');
    const introBox = el('input');
    introBox.type = 'checkbox';
    introBox.checked = game.settings.intro;
    introBox.addEventListener('change', () => {
      game.settings.intro = introBox.checked;
      saveSettings(game.settings);
    });
    intro.append(introBox, el('span', undefined, 'Play the intro when a new game starts'));
    settingsBlock.append(intro);

    // The narrator speaks in the browser's own voice, so the choice is of the voices the browser has: none to offer where it has no speech, and the captions tell the film all the same.
    const speech = speechPort === undefined ? createBrowserSpeech() : speechPort;
    if (speech) {
      const narrate = el('label', 'setting toggle');
      const narrateBox = el('input');
      narrateBox.type = 'checkbox';
      narrateBox.checked = game.settings.narration;
      narrateBox.addEventListener('change', () => {
        game.settings.narration = narrateBox.checked;
        voiceRow.hidden = !narrateBox.checked;
        saveSettings(game.settings);
      });
      narrate.append(
        narrateBox,
        el('span', undefined, 'Narrate the intro aloud (captions always show)'),
      );
      settingsBlock.append(narrate);

      const voice = choice('Narrator voice', [], (value) => {
        game.settings.narrator = value;
        saveSettings(game.settings);
      });
      const voiceRow = voice.parentElement as HTMLElement;
      voiceRow.classList.add('has-button');
      voiceRow.hidden = !game.settings.narration;
      const hear = el('button', 'quiet-button hear-voice', 'Hear it');
      hear.type = 'button';
      voiceRow.append(hear);

      /** The voices the browser has, best first, after "Automatic", which says which one it would take. */
      const fillVoices = (): void => {
        const all = speech.voices();
        const ranked = rankVoices(all, navigator.language);
        const best = ranked[0];
        const kept = ranked.some((entry) => entry.id === game.settings.narrator);
        // A browser that lists no voices may still speak (some list them late, or never), so it is left to try; one that lists only other languages is not asked to read English.
        voice.disabled = ranked.length === 0;
        hear.hidden = all.length > 0 && ranked.length === 0;
        setOptions(voice, [
          {
            value: '',
            label: best
              ? `Automatic: ${best.name}`
              : all.length > 0
                ? 'No English voice in this browser'
                : 'Automatic (this browser lists no voices)',
          },
          ...ranked.map((entry) => ({ value: entry.id, label: `${entry.name} (${entry.lang})` })),
        ]);
        voice.value = kept ? game.settings.narrator : '';
      };
      fillVoices();
      // Some browsers list their voices only a moment after the page has loaded.
      speech.onVoices(fillVoices);

      hear.addEventListener('click', (event) => {
        event.stopPropagation();
        const chosen = speech.voices().find((entry) => entry.id === voice.value);
        const best = rankVoices(speech.voices(), navigator.language)[0];
        const using = chosen ?? best;
        speech.cancel();
        speech.speak(
          {
            text: SAMPLE_LINE,
            voice: using?.id ?? null,
            lang: using?.lang ?? 'en-US',
            rate: 1,
            volume: gainOfVolume(game.settings.volume),
          },
          { start: () => undefined, end: () => undefined, error: () => undefined },
        );
      });
    }
  }

  const graphics = choice(
    'Graphics',
    QUALITY_NAMES.map((name) => ({ value: name, label: capitalized(name) })),
    (value) => {
      if (!isQualityName(value)) return;
      game.setQuality(value);
      saveSettings(game.settings);
    },
  );
  // A preview of the light at each hour, for development: in play the sky follows the run's clock.
  const timeOfDay = skyPreview
    ? choice(
        'Time of day',
        [
          ...Object.keys(TIME_PRESETS).map((name) => ({
            value: name,
            label: MOMENT_LABELS[name] ?? capitalized(name),
          })),
          { value: CLOCK, label: 'Day and night cycle' },
        ],
        (value) => game.stage.setMoment(value === CLOCK ? null : value),
      )
    : null;
  card.append(settingsBlock);

  card.append(el('p', 'footnote', `Build ${buildId}`));
  root.append(card);

  // Any click counts as "click to play", except on the settings, which are for clicking.
  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.settings')) return;
    game.input.requestLock();
  });

  const refresh = (): void => {
    graphics.value = game.stage.quality.name;
    if (timeOfDay) timeOfDay.value = game.stage.moment ?? CLOCK;
    hint.textContent = game.input.blocked
      ? 'The browser did not hand over the mouse. Wait a moment, then click Play again.'
      : 'Esc frees the mouse at any time. F5 will not reload the page while you are playing.';
    hint.classList.toggle('warn', game.input.blocked);
  };
  refresh();

  const setRun = (line: string | null): void => {
    runLine.hidden = line === null;
    if (line !== null) runLine.textContent = line;
  };

  return { element: root, refresh, setRun };
}
