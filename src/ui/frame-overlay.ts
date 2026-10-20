import type { Game } from '../engine/game';
import { el } from './dom';

/** Frame-time overlay: current frame rate, a graph of recent frames and a few numbers about the scene. */

const GRAPH_WIDTH = 240;
const GRAPH_HEIGHT = 44;
/** The graph's height covers this many milliseconds; anything slower is clipped at the top. */
const GRAPH_MAX_MS = 40;
const TEXT_INTERVAL_MS = 250;

const GOOD = '#3ad1e0';
const WARN = '#f2a43a';
const BAD = '#e8603c';

export interface FrameOverlay {
  readonly element: HTMLElement;
  readonly visible: boolean;
  setVisible(visible: boolean): void;
  /** Redraws the graph, and the numbers a few times a second. Call once per frame. */
  update(): void;
}

function ms(value: number, digits = 1): string {
  return value.toFixed(digits);
}

export function createFrameOverlay(game: Game): FrameOverlay {
  const root = el('aside', 'frame-overlay');
  root.setAttribute('aria-label', 'Frame times');
  root.hidden = true;

  const head = el('div', 'fo-head');
  const fps = el('span', 'fo-fps', '--');
  const unit = el('span', 'fo-unit', 'FPS');
  const current = el('span', 'fo-ms', '-- ms');
  head.append(fps, unit, current);

  const canvas = el('canvas', 'fo-graph');
  const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = GRAPH_WIDTH * ratio;
  canvas.height = GRAPH_HEIGHT * ratio;
  canvas.style.width = `${GRAPH_WIDTH}px`;
  canvas.style.height = `${GRAPH_HEIGHT}px`;
  const g = canvas.getContext('2d');

  const rows = el('dl', 'fo-rows');
  const row = (label: string): HTMLElement => {
    const wrap = el('div');
    const value = el('dd');
    wrap.append(el('dt', undefined, label), value);
    rows.append(wrap);
    return value;
  };
  const frameRow = row('frame');
  const cpuRow = row('cpu');
  const sceneRow = row('scene');
  const playerRow = row('player');
  const motionRow = row('motion');
  const viewRow = row('view');
  const canvasRow = row('canvas');
  const gpuRow = row('gpu');
  gpuRow.textContent = game.gpu;
  gpuRow.classList.add('fo-gpu');

  root.append(head, canvas, rows);

  let visible = false;
  let lastText = 0;

  const drawGraph = (): void => {
    if (!g) return;
    const { frameMs } = game.timing;
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.clearRect(0, 0, GRAPH_WIDTH, GRAPH_HEIGHT);
    const bars = GRAPH_WIDTH / 2;
    const count = Math.min(bars, frameMs.length);
    for (let i = 0; i < count; i++) {
      const value = frameMs.fromNewest(count - 1 - i);
      const height = Math.min(GRAPH_HEIGHT, (value / GRAPH_MAX_MS) * GRAPH_HEIGHT);
      g.fillStyle = value <= 17.6 ? GOOD : value <= 25 ? WARN : BAD;
      g.fillRect(GRAPH_WIDTH - (count - i) * 2, GRAPH_HEIGHT - height, 1.6, height);
    }
    // Guides at one and two 60 Hz refreshes.
    g.fillStyle = 'rgba(244, 234, 210, 0.35)';
    g.fillRect(0, GRAPH_HEIGHT - (16.7 / GRAPH_MAX_MS) * GRAPH_HEIGHT, GRAPH_WIDTH, 1);
    g.fillStyle = 'rgba(244, 234, 210, 0.2)';
    g.fillRect(0, GRAPH_HEIGHT - (33.4 / GRAPH_MAX_MS) * GRAPH_HEIGHT, GRAPH_WIDTH, 1);
  };

  const drawText = (): void => {
    const { frameMs, cpuMs, ticks, drawCalls, triangles } = game.timing;
    const summary = frameMs.summary();
    const cpu = cpuMs.summary();
    fps.textContent = summary.frames > 0 ? Math.round(summary.fps).toString() : '--';
    current.textContent = summary.frames > 0 ? `${ms(summary.avgMs)} ms` : '-- ms';
    frameRow.textContent = `avg ${ms(summary.avgMs)} · p95 ${ms(summary.p95Ms)} · max ${ms(summary.maxMs, 0)}`;
    cpuRow.textContent = `${ms(cpu.avgMs, 2)} ms · ${ticks} tick${ticks === 1 ? '' : 's'}`;
    sceneRow.textContent = `${drawCalls} calls · ${(triangles / 1000).toFixed(1)}k tris`;
    const { player, rig } = game;
    playerRow.textContent = `${ms(player.x, 2)}  ${ms(player.y, 2)}  ${ms(player.z, 2)}`;
    const speed = Math.hypot(player.vx, player.vz);
    motionRow.textContent = `${ms(speed)} b/s · ${player.onGround ? 'ground' : 'air'}`;
    viewRow.textContent = `${rig.mode === 'first' ? 'first' : 'third'} person · fov ${Math.round(game.stage.camera.fov)}`;
    const { domElement } = game.stage.renderer;
    canvasRow.textContent = `${domElement.width}×${domElement.height} px · ${window.devicePixelRatio.toFixed(2)}x`;
  };

  return {
    element: root,
    get visible() {
      return visible;
    },
    setVisible(next) {
      visible = next;
      root.hidden = !next;
      if (next) drawText();
    },
    update() {
      if (!visible) return;
      drawGraph();
      const now = performance.now();
      if (now - lastText >= TEXT_INTERVAL_MS) {
        lastText = now;
        drawText();
      }
    },
  };
}
