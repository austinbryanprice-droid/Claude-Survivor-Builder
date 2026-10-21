import type { Game } from '../engine/game';
import { TARGET_FPS, holdsTarget } from '../shared/bench-report';
import { formatSweepReport, type PresetRun } from '../shared/sweep-report';
import { el } from './dom';

/**
 * The benchmark's progress banner and its results card. `?bench=1` flies the valley once for each
 * preset; the card shows how each one did and the report to paste back into the thread.
 */

export interface BenchPanel {
  /** Progress banner shown while the run takes over the controls. */
  readonly banner: HTMLElement;
  /** Results (or the reason the run stopped), with copy and rerun buttons. */
  readonly results: HTMLElement;
  /** True while the results card should be on screen. */
  readonly showingResults: boolean;
  /** Redraws the banner and, when a run just ended, the results. */
  refresh(): void;
}

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export function createBenchPanel(game: Game, onChange: () => void): BenchPanel {
  const sweep = game.sweep;

  const banner = el('div', 'hud-panel bench-banner');
  banner.setAttribute('role', 'status');
  const bannerText = el('span', 'bench-text');
  const track = el('div', 'bench-track');
  const fill = el('div', 'bench-fill');
  track.append(fill);
  banner.append(bannerText, track, el('span', 'bench-hint', 'Esc stops it'));
  banner.hidden = true;

  const results = el('section', 'bench-results');
  results.setAttribute('role', 'dialog');
  results.setAttribute('aria-label', 'Benchmark results');
  const card = el('div', 'hud-panel results-card');
  results.append(card);
  results.hidden = true;
  card.addEventListener('click', (event) => event.stopPropagation());

  let dismissed = false;
  let drawnFor = '';

  const dismiss = (): void => {
    dismissed = true;
    onChange();
  };
  const rerun = (): void => {
    dismissed = false;
    sweep.start();
  };

  const button = (label: string, primary: boolean, onClick: () => void): HTMLButtonElement => {
    const node = el('button', primary ? 'play-button' : 'quiet-button', label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  };

  const stat = (value: string, label: string): HTMLElement => {
    const tile = el('div', 'stat');
    tile.append(el('strong', undefined, value), el('span', undefined, label));
    return tile;
  };

  const table = (runs: readonly PresetRun[]): HTMLElement => {
    const grid = el('table', 'bench-table');
    const head = el('tr');
    for (const name of ['Preset', 'Size', 'FPS', 'p95 ms', 'GPU ms', `Holds ${TARGET_FPS}`]) {
      head.append(el('th', undefined, name));
    }
    grid.append(head);
    for (const run of runs) {
      const frames = run.report.frames;
      const holds = holdsTarget(frames);
      const row = el('tr');
      row.dataset.preset = run.preset;
      row.dataset.holds = holds ? 'yes' : 'no';
      for (const text of [
        capitalized(run.preset),
        `${run.width}×${run.height}`,
        frames.fps.toFixed(1),
        frames.p95Ms.toFixed(1),
        run.gpu ? run.gpu.avgMs.toFixed(1) : '-',
        holds ? 'yes' : 'no',
      ]) {
        row.append(el('td', undefined, text));
      }
      grid.append(row);
    }
    return grid;
  };

  const drawResults = (): void => {
    card.replaceChildren();
    card.append(el('p', 'kicker', 'Benchmark'));
    const runs = sweep.runs;
    // Balanced is the preset that has to hold 60; it speaks for the sweep when it ran.
    const headline = runs.find((run) => run.preset === 'balanced') ?? runs[0];
    const stopped = sweep.state === 'cancelled';
    const rerunRow = (...extra: HTMLElement[]): HTMLElement => {
      const row = el('div', 'button-row');
      row.append(
        ...extra,
        button('Run again', !headline, rerun),
        button('Back to game', false, dismiss),
      );
      return row;
    };

    if (stopped) {
      card.append(el('h1', undefined, 'Run stopped'));
      const finished =
        runs.length > 0 ? ` ${runs.length} of ${sweep.presetCount} presets finished.` : '';
      card.append(el('p', 'lede', `${sweep.note || 'The run did not finish.'}${finished}`));
    } else if (headline) {
      const holds = holdsTarget(headline.report.frames);
      card.append(
        el(
          'h1',
          holds ? 'good' : 'warn',
          holds
            ? `${capitalized(headline.preset)} holds ${TARGET_FPS} FPS`
            : `${capitalized(headline.preset)} is below ${TARGET_FPS} FPS`,
        ),
      );
      card.append(
        el(
          'p',
          'lede',
          `${runs.length} presets, ${sweep.seconds} s of valley each, on a display of about ${headline.report.refreshHz} Hz.`,
        ),
      );
    }
    if (!headline) {
      card.append(rerunRow());
      return;
    }

    const frames = headline.report.frames;
    const stats = el('div', 'stats');
    stats.append(
      stat(frames.fps.toFixed(1), `average FPS, ${headline.preset}`),
      stat(`${frames.p95Ms.toFixed(1)} ms`, '95th percentile'),
      stat(frames.low1PctFps.toFixed(0), 'slowest 1% FPS'),
      stat(String(frames.slowFrames), 'frames over 33 ms'),
    );
    card.append(stats, table(runs));
    card.append(el('p', 'gpu-line', `GPU: ${headline.report.environment.gpu}`));

    const text = formatSweepReport(runs, game.sweepExtras());
    const pre = el('pre', 'report-text', text);
    pre.tabIndex = 0;
    card.append(pre);

    const status = el('span', 'copy-status');
    status.setAttribute('role', 'status');
    const selectText = (): void => {
      const range = document.createRange();
      range.selectNodeContents(pre);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      status.textContent = 'Selected. Press Ctrl+C (Cmd+C on a Mac) to copy.';
    };
    const copy = button('Copy results', true, () => {
      if (!navigator.clipboard) {
        selectText();
        return;
      }
      navigator.clipboard
        .writeText(text)
        .then(() => {
          status.textContent = 'Copied. Paste it into the chat.';
        })
        .catch(selectText);
    });
    const row = rerunRow(copy);
    row.append(status);
    card.append(row);
  };

  const panel: BenchPanel = {
    banner,
    results,
    get showingResults() {
      return (sweep.state === 'done' || sweep.state === 'cancelled') && !dismissed;
    },
    refresh() {
      banner.hidden = !sweep.active;
      if (sweep.active) {
        const preset = capitalized(sweep.preset ?? '');
        const where = `${preset} (${sweep.presetNumber + 1} of ${sweep.presetCount})`;
        bannerText.textContent = sweep.warmingUp
          ? `Benchmark: ${where}, warming up`
          : `Benchmark: ${where}, ${Math.round(sweep.progress * 100)}%`;
        const overall = (sweep.presetNumber + sweep.progress) / Math.max(1, sweep.presetCount);
        fill.style.width = `${Math.round(overall * 100)}%`;
      }
      if (sweep.state === 'done' || sweep.state === 'cancelled') {
        // Draw the card once per finished sweep, not on every refresh.
        const key = `${sweep.state}:${sweep.runs.length}:${sweep.runs.at(-1)?.report.finishedAt ?? sweep.note}`;
        if (key !== drawnFor) {
          drawnFor = key;
          dismissed = false;
          drawResults();
        }
      } else {
        drawnFor = '';
        dismissed = false;
      }
      results.hidden = !panel.showingResults;
    },
  };
  return panel;
}
