import { el } from '../dom';
import { iconMarkup, type IconId } from './icons';

/**
 * The research ladder a Research Terminal shows (Phase 5d2): the points the crew has earned, how far
 * they are from the next row, and the four materials with which are open, which wait for a Terminal
 * to read the points that reach them and which are still ahead. A read-only panel beside the
 * crosshair, drawn in the HUD's own frames and fonts; `PlayerHud` owns one and hands it the state.
 */

/** One row of the ladder: a material and how the crew stands to it. */
export interface HudLadderRow {
  /** The material's block icon. */
  readonly icon: IconId | null;
  /** "Reinforced Composite". */
  readonly name: string;
  /** What opens it: "From the start" or "20 points". */
  readonly need: string;
  /** 'open' once a Terminal has read the points that reach it, 'waiting' when the crew has earned them and none has, else 'shut'. */
  readonly state: 'open' | 'waiting' | 'shut';
  /** The word at the end of the row: "Open", "Not read yet" or "35 to go". */
  readonly note: string;
}

/** Everything the panel shows. */
export interface HudLadder {
  /** "Research Terminal". */
  readonly title: string;
  /** The points the crew has earned, the big number. */
  readonly points: string;
  /** The words under the number: "points earned". */
  readonly caption: string;
  /** 0 to 1: the points as a share of the next row's, and 1 once the ladder is climbed. */
  readonly fraction: number;
  /** The words at the end of the bar: "20 to Alloy" or "Ladder climbed". */
  readonly next: string;
  readonly rows: readonly HudLadderRow[];
  /** The line at the foot: how points are earned. */
  readonly footer: string;
}

/** The key that shuts the panel, as its cap reads, and the words beside it. */
const CLOSE_KEY = 'E';
const CLOSE_LABEL = 'Close';

export class ResearchLadder {
  readonly root: HTMLElement;

  private readonly title: HTMLElement;
  private readonly points: HTMLElement;
  private readonly caption: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly next: HTMLElement;
  private readonly rows: HTMLElement;
  private readonly footer: HTMLElement;
  private last = '';

  constructor() {
    this.root = el('section', 'ph-ladder');
    this.root.hidden = true;
    const frame = el('div', 'ph-frame ph-ladder-card');
    this.title = el('strong', 'ph-ladder-title');
    const total = el('div', 'ph-ladder-total');
    this.points = el('b', 'ph-ladder-points');
    this.caption = el('span', 'ph-ladder-caption');
    total.append(this.points, this.caption);
    const track = el('i', 'ph-ladder-track');
    this.fill = el('i', 'ph-ladder-fill');
    track.append(this.fill);
    this.next = el('span', 'ph-ladder-next');
    const progress = el('div', 'ph-ladder-progress');
    progress.append(track, this.next);
    this.rows = el('ul', 'ph-ladder-rows');
    this.footer = el('p', 'ph-ladder-footer');
    const close = el('div', 'ph-ladder-close');
    close.append(el('kbd', 'ph-key', CLOSE_KEY), el('span', undefined, CLOSE_LABEL));
    frame.append(this.title, total, progress, this.rows, this.footer, close);
    this.root.append(frame);
  }

  /** Shows the panel for this state, or hides it for null; touches the DOM only when something changed. */
  update(ladder: HudLadder | null): void {
    const key = ladder === null ? '' : JSON.stringify(ladder);
    if (key === this.last) return;
    this.last = key;
    this.root.hidden = ladder === null;
    if (ladder === null) return;
    this.title.textContent = ladder.title;
    this.points.textContent = ladder.points;
    this.caption.textContent = ladder.caption;
    this.fill.style.width = `${(Math.min(1, Math.max(0, ladder.fraction)) * 100).toFixed(1)}%`;
    this.next.textContent = ladder.next;
    this.footer.textContent = ladder.footer;
    this.rows.replaceChildren(
      ...ladder.rows.map((row) => {
        const item = el('li', 'ph-ladder-row');
        item.dataset.state = row.state;
        const icon = el('span', 'ph-ladder-icon');
        icon.innerHTML = row.icon ? iconMarkup(row.icon) : '';
        const words = el('span', 'ph-ladder-words');
        words.append(
          el('strong', 'ph-ladder-name', row.name),
          el('small', 'ph-ladder-need', row.need),
        );
        item.append(icon, words, el('span', 'ph-ladder-note', row.note));
        return item;
      }),
    );
  }
}
