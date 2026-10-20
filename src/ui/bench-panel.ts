import type { Game } from '../engine/game';
import { TARGET_FPS, formatBenchReport, holdsTarget } from '../shared/bench-report';
import { el } from './dom';

/** The benchmark's progress banner and its results card. */

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

export function createBenchPanel(game: Game, onChange: () => void): BenchPanel {
  const bench = game.bench;

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
    bench.start();
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

  const drawResults = (): void => {
    card.replaceChildren();
    card.append(el('p', 'kicker', 'Benchmark'));
    const { report } = bench;
    if (bench.state === 'cancelled' || !report) {
      card.append(el('h1', undefined, 'Run stopped'));
      card.append(el('p', 'lede', bench.note || 'The run did not finish.'));
      const row = el('div', 'button-row');
      row.append(button('Run again', true, rerun), button('Back to game', false, dismiss));
      card.append(row);
      return;
    }

    const holds = holdsTarget(report.frames);
    card.append(
      el(
        'h1',
        holds ? 'good' : 'warn',
        holds ? `Holds ${TARGET_FPS} FPS` : `Below ${TARGET_FPS} FPS`,
      ),
    );
    card.append(
      el(
        'p',
        'lede',
        `${report.frames.frames} frames over ${report.wallSeconds.toFixed(1)} s on a display of about ${report.refreshHz} Hz.`,
      ),
    );
    const stats = el('div', 'stats');
    stats.append(
      stat(report.frames.fps.toFixed(1), 'average FPS'),
      stat(`${report.frames.p95Ms.toFixed(1)} ms`, '95th percentile'),
      stat(report.frames.low1PctFps.toFixed(0), 'slowest 1% FPS'),
      stat(String(report.frames.slowFrames), 'frames over 33 ms'),
    );
    card.append(stats);
    card.append(el('p', 'gpu-line', `GPU: ${report.environment.gpu}`));

    const text = formatBenchReport(report);
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
    const row = el('div', 'button-row');
    row.append(
      copy,
      button('Run again', false, rerun),
      button('Back to game', false, dismiss),
      status,
    );
    card.append(row);
  };

  const panel: BenchPanel = {
    banner,
    results,
    get showingResults() {
      return (bench.state === 'done' || bench.state === 'cancelled') && !dismissed;
    },
    refresh() {
      const state = bench.state;
      banner.hidden = !bench.takesOver;
      if (bench.takesOver) {
        bannerText.textContent =
          state === 'warmup'
            ? 'Benchmark: warming up'
            : `Benchmark: ${Math.round(bench.progress * bench.scriptSeconds)} of ${bench.scriptSeconds} s`;
        fill.style.width = `${Math.round(bench.progress * 100)}%`;
      }
      if (state === 'done' || state === 'cancelled') {
        // Draw the card once per finished run, not on every refresh.
        const key = `${state}:${bench.report?.finishedAt ?? bench.note}`;
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
