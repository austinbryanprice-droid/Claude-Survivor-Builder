import type { Lobby, LobbyState } from '../net/lobby';
import { NET } from '../shared/net-config';
import { colorForSlot } from '../shared/player-colors';
import type { RosterEntry } from '../net/session';
import { el } from './dom';
import './room-panel.css';

/**
 * Everything the player sees of multiplayer: the card on the start screen (host a room, join one
 * by code, the room's code and who is in it), a small roster while playing, and the full-screen
 * notice when a room ends. It draws `Lobby.state` and calls the lobby's buttons; it has no
 * network code of its own. It lives in its own layer above the HUD, so clicking it never counts
 * as "click to play".
 */

type RoomActions = Pick<
  Lobby,
  'state' | 'onChange' | 'host' | 'join' | 'cancel' | 'leave' | 'playAlone' | 'setName'
>;

export interface RoomPanelOptions {
  lobby: RoomActions;
  /** The link a friend opens to land in this room. */
  inviteLink(code: string): string;
  /** True while the mouse is captured and the player is moving about. */
  isPlaying(): boolean;
  /** Calls `listener` whenever `isPlaying()` may have changed. */
  onPlayingChange(listener: () => void): () => void;
  /** Gives the mouse back, which the notice that a room ended needs. */
  releaseMouse(): void;
  /** Lines to show at the foot of the card: a custom network, switches in the address that were ignored. */
  notes?: readonly string[];
  /** Below this window width the card starts folded, so it does not cover the start screen. */
  foldBelowWidth?: number;
}

export interface RoomPanel {
  readonly element: HTMLElement;
  dispose(): void;
}

const TOAST_MS = 4500;
const COPIED_MS = 2200;
const CONFIRM_MS = 5000;

function pingText(entry: RosterEntry): string {
  return entry.pingMs === null ? '' : `${Math.round(entry.pingMs)} ms`;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function textInput(
  className: string,
  placeholder: string,
  label: string,
  maxLength: number,
): HTMLInputElement {
  const input = el('input', className);
  input.type = 'text';
  input.placeholder = placeholder;
  input.maxLength = maxLength;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', label);
  input.setAttribute('autocapitalize', 'off');
  return input;
}

/** Puts `text` on the clipboard; falls back to an old trick where the clipboard API is not offered (plain http). */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the fallback.
  }
  const area = el('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

interface RosterList {
  readonly element: HTMLUListElement;
  update(roster: readonly RosterEntry[], localId: number): void;
}

function createRosterList(className: string, withPing: boolean): RosterList {
  const list = el('ul', className);
  return {
    element: list,
    update(roster, localId) {
      list.replaceChildren();
      for (const entry of roster) {
        const row = el('li', 'mp-player');
        const dot = el('i', 'mp-dot');
        dot.style.background = colorForSlot(entry.slot).hex;
        dot.setAttribute('aria-hidden', 'true');
        const name = el('span', 'mp-name', entry.name);
        row.append(dot, name);
        if (entry.id === localId) row.append(el('span', 'mp-tag', 'you'));
        if (entry.isHost) row.append(el('span', 'mp-tag mp-tag-host', 'host'));
        if (withPing) {
          const ping = pingText(entry);
          if (ping) row.append(el('span', 'mp-ping', ping));
        }
        list.append(row);
      }
    },
  };
}

export function createRoomPanel(options: RoomPanelOptions): RoomPanel {
  const { lobby } = options;
  const foldBelow = options.foldBelowWidth ?? 1250;

  const root = el('div', 'mp');
  root.id = 'mp';

  // ------------------------------------------------------------------------------------------
  // The card on the start screen.
  // ------------------------------------------------------------------------------------------

  const card = el('section', 'mp-card');
  card.setAttribute('aria-label', 'Play together');
  const head = el('header', 'mp-head');
  const headText = el('div', 'mp-head-text');
  const kicker = el('p', 'mp-kicker', 'Multiplayer');
  const title = el('h2', 'mp-title', 'Play together');
  headText.append(kicker, title);
  const fold = el('button', 'mp-fold');
  fold.type = 'button';
  fold.setAttribute('aria-controls', 'mp-body');
  head.append(headText, fold);

  const body = el('div', 'mp-body');
  body.id = 'mp-body';

  // Alone: pick a name, host, or join.
  const alone = el('div', 'mp-alone');
  alone.append(
    el(
      'p',
      'mp-lede',
      'Up to four players build and survive in one world. One of you hosts a room; the others join it with a code.',
    ),
  );
  const nameRow = el('label', 'mp-field');
  const nameInput = textInput('mp-input', 'Your name', 'Your name', NET.maxNameLength);
  nameRow.append(el('span', 'mp-field-label', 'Your name'), nameInput);
  const hostButton = button('Host a room', 'mp-primary', () => lobby.host());
  const divider = el('p', 'mp-divider', 'or join a friend');
  const joinRow = el('div', 'mp-join');
  const codeInput = textInput('mp-input mp-code-input', 'Room code', 'Room code', 160);
  codeInput.setAttribute('autocapitalize', 'characters');
  const joinButton = button('Join', 'mp-secondary', () => lobby.join(codeInput.value));
  joinRow.append(codeInput, joinButton);
  alone.append(
    nameRow,
    hostButton,
    divider,
    joinRow,
    el(
      'p',
      'mp-fine',
      "If the host leaves, the session ends for everyone: this version has no host migration. Joining a room replaces the world on this page with the host's.",
    ),
  );

  // Busy: asking for a room, or dialling one.
  const busy = el('div', 'mp-busy');
  const busyText = el('p', 'mp-busy-text');
  busyText.setAttribute('role', 'status');
  const busyHint = el('p', 'mp-fine');
  const cancelButton = button('Cancel', 'mp-secondary', () => lobby.cancel());
  const spinner = el('div', 'mp-spinner');
  spinner.setAttribute('aria-hidden', 'true');
  busy.append(spinner, busyText, busyHint, cancelButton);

  // In a room: the code, the people, the way out.
  const room = el('div', 'mp-room');
  const codeBlock = el('div', 'mp-code-block');
  const codeLabel = el('p', 'mp-field-label', 'Room code');
  const codeBig = el('output', 'mp-code');
  codeBig.setAttribute('aria-live', 'polite');
  const copyRow = el('div', 'mp-copy-row');
  const copyCode = button('Copy code', 'mp-secondary', () => void copy(currentCode(), 'code'));
  const copyLink = button(
    'Copy invite link',
    'mp-secondary',
    () => void copy(currentLink(), 'link'),
  );
  const copied = el('span', 'mp-copied');
  copied.setAttribute('role', 'status');
  copyRow.append(copyCode, copyLink, copied);
  const linkField = el('input', 'mp-input mp-link');
  linkField.type = 'text';
  linkField.readOnly = true;
  linkField.setAttribute('aria-label', 'Invite link');
  linkField.addEventListener('focus', () => linkField.select());
  codeBlock.append(codeLabel, codeBig, copyRow, linkField);

  const rosterLabel = el('p', 'mp-field-label', 'In this room');
  const roster = createRosterList('mp-roster', true);
  const roomHint = el('p', 'mp-fine');
  const offline = el('p', 'mp-warning');
  offline.setAttribute('role', 'alert');
  offline.textContent =
    'The matchmaking server has lost your room. Players already here can keep playing, but nobody new can join until it is back.';
  const leaveRow = el('div', 'mp-leave-row');
  const leaveButton = button('Leave room', 'mp-secondary mp-leave', () => onLeave());
  const confirmText = el('span', 'mp-confirm mp-confirm-text', 'End the session for everyone?');
  const confirmYes = button('End session', 'mp-danger mp-confirm', () => {
    disarm();
    lobby.leave();
  });
  const confirmNo = button('Keep playing', 'mp-secondary mp-confirm', () => disarm());
  leaveRow.append(leaveButton, confirmText, confirmYes, confirmNo);
  room.append(codeBlock, rosterLabel, roster.element, roomHint, offline, leaveRow);

  const notice = el('div', 'mp-notice');
  notice.setAttribute('role', 'alert');
  const noticeTitle = el('p', 'mp-notice-title');
  const noticeDetail = el('p', 'mp-notice-detail');
  notice.append(noticeTitle, noticeDetail);

  const notes = el('ul', 'mp-notes');
  for (const line of options.notes ?? []) notes.append(el('li', undefined, line));
  notes.hidden = (options.notes ?? []).length === 0;

  body.append(alone, busy, room, notice, notes);
  card.append(head, body);

  // ------------------------------------------------------------------------------------------
  // The roster while playing, and the toasts.
  // ------------------------------------------------------------------------------------------

  const mini = el('aside', 'mp-mini');
  mini.setAttribute('aria-label', 'Players in the room');
  const miniCode = el('p', 'mp-mini-code');
  const miniRoster = createRosterList('mp-mini-roster', false);
  mini.append(miniCode, miniRoster.element);

  const toasts = el('div', 'mp-toasts');
  toasts.setAttribute('role', 'status');
  toasts.setAttribute('aria-live', 'polite');

  // ------------------------------------------------------------------------------------------
  // The notice that a room is gone.
  // ------------------------------------------------------------------------------------------

  const ended = el('div', 'mp-ended');
  ended.setAttribute('role', 'alertdialog');
  ended.setAttribute('aria-modal', 'true');
  ended.setAttribute('aria-labelledby', 'mp-ended-title');
  ended.setAttribute('aria-describedby', 'mp-ended-detail');
  const endedCard = el('div', 'mp-ended-card');
  const endedKicker = el('p', 'mp-kicker', 'Session ended');
  const endedTitle = el('h2', 'mp-ended-title');
  endedTitle.id = 'mp-ended-title';
  const endedDetail = el('p', 'mp-ended-detail');
  endedDetail.id = 'mp-ended-detail';
  const endedAlone = button('Play alone', 'mp-primary', () => lobby.playAlone());
  const endedJoinRow = el('div', 'mp-join');
  const endedCode = textInput(
    'mp-input mp-code-input',
    'Another room code',
    'Another room code',
    160,
  );
  endedCode.setAttribute('autocapitalize', 'characters');
  const endedJoin = button('Join', 'mp-secondary', () => lobby.join(endedCode.value));
  endedJoinRow.append(endedCode, endedJoin);
  const endedNotice = el('p', 'mp-ended-error');
  endedNotice.setAttribute('role', 'alert');
  endedCard.append(
    endedKicker,
    endedTitle,
    endedDetail,
    endedAlone,
    el('p', 'mp-divider', 'or join another room'),
    endedJoinRow,
    endedNotice,
    el(
      'p',
      'mp-fine',
      'Playing alone keeps the world as it was when the room closed, so the blocks you built together are still there.',
    ),
  );
  ended.append(endedCard);

  root.append(card, mini, toasts, ended);

  // ------------------------------------------------------------------------------------------
  // Behaviour.
  // ------------------------------------------------------------------------------------------

  const timers = new Set<number>();
  const later = (ms: number, run: () => void): number => {
    const handle = window.setTimeout(() => {
      timers.delete(handle);
      run();
    }, ms);
    timers.add(handle);
    return handle;
  };

  let folded = window.innerWidth < foldBelow;
  let foldedByPlayer = false;
  let armed: number | null = null;
  let copiedTimer: number | null = null;
  let lastStatus: LobbyState['status'] | null = null;
  let lastNotice: LobbyState['notice'] = null;
  let known = new Map<number, string>();

  const currentCode = (): string => lobby.state.code ?? '';
  const currentLink = (): string => (lobby.state.code ? options.inviteLink(lobby.state.code) : '');

  function setCopied(text: string): void {
    copied.textContent = text;
    if (copiedTimer !== null) window.clearTimeout(copiedTimer);
    copiedTimer = text ? window.setTimeout(() => setCopied(''), COPIED_MS) : null;
  }

  async function copy(text: string, what: 'code' | 'link'): Promise<void> {
    if (!text) return;
    const ok = await copyText(text);
    if (ok) {
      setCopied(what === 'code' ? 'Code copied' : 'Link copied');
    } else {
      // The clipboard is off limits: show the text selected so the player can copy it by hand.
      if (what === 'link') {
        linkField.focus();
        linkField.select();
      }
      setCopied('Select and copy it by hand');
    }
  }

  function arm(): void {
    root.dataset.confirm = 'true';
    if (armed !== null) window.clearTimeout(armed);
    armed = window.setTimeout(disarm, CONFIRM_MS);
  }

  function disarm(): void {
    if (armed !== null) window.clearTimeout(armed);
    armed = null;
    delete root.dataset.confirm;
  }

  function onLeave(): void {
    const { status, roster: people } = lobby.state;
    // Closing a room with people in it ends the session for all of them: ask first.
    if (status === 'hosting' && people.length > 1) arm();
    else lobby.leave();
  }

  function toast(text: string, color: string): void {
    const item = el('p', 'mp-toast');
    const dot = el('i', 'mp-dot');
    dot.style.background = color;
    item.append(dot, el('span', undefined, text));
    toasts.append(item);
    while (toasts.children.length > 4) toasts.firstElementChild?.remove();
    later(TOAST_MS, () => item.remove());
  }

  function announce(state: LobbyState): void {
    const inRoom = state.status === 'hosting' || state.status === 'joined';
    if (!inRoom) {
      known = new Map();
      return;
    }
    const next = new Map(state.roster.map((entry) => [entry.id, entry.name] as const));
    if (known.size > 0) {
      for (const entry of state.roster) {
        if (!known.has(entry.id) && entry.id !== state.localId) {
          toast(`${entry.name} joined`, colorForSlot(entry.slot).hex);
        }
      }
      for (const [id, name] of known) {
        if (!next.has(id)) toast(`${name} left`, 'rgb(244 234 210 / 50%)');
      }
    }
    known = next;
  }

  function renderFold(): void {
    const state = lobby.state;
    // A room, a failure or a half-made join is always worth seeing.
    const mustShow = state.status !== 'alone' || state.notice !== null;
    const hide = folded && !mustShow;
    card.dataset.folded = String(hide);
    fold.textContent = hide ? 'Open' : 'Fold';
    fold.setAttribute('aria-expanded', String(!hide));
    fold.hidden = mustShow;
  }

  let rendering = false;
  let again = false;

  function render(): void {
    // Giving the mouse back can report a change straight away: draw once more when this one is done.
    if (rendering) {
      again = true;
      return;
    }
    rendering = true;
    try {
      do {
        again = false;
        draw();
      } while (again);
    } finally {
      rendering = false;
    }
  }

  function draw(): void {
    const state = lobby.state;
    const playing = options.isPlaying();
    const inRoom = state.status === 'hosting' || state.status === 'joined';
    root.dataset.status = state.status;
    root.dataset.mode = playing ? 'playing' : 'free';
    root.dataset.online = String(state.roomOnline);

    // A new kind of state always deserves the player's eye, even on a folded card.
    if (state.status !== lastStatus && !foldedByPlayer) folded = false;
    if (state.status !== lastStatus && state.status !== 'hosting') disarm();
    if (state.notice !== lastNotice && state.notice && !foldedByPlayer) folded = false;

    card.hidden = playing || state.status === 'ended';
    mini.hidden = !(playing && inRoom);
    ended.hidden = state.status !== 'ended';

    // Titles and sections.
    alone.hidden = state.status !== 'alone';
    busy.hidden = !(state.status === 'opening' || state.status === 'joining');
    room.hidden = !inRoom;
    switch (state.status) {
      case 'alone':
        title.textContent = 'Play together';
        break;
      case 'opening':
        title.textContent = 'Opening a room';
        busyText.textContent = 'Asking for a room code…';
        busyHint.textContent = 'This takes a few seconds.';
        cancelButton.hidden = true;
        break;
      case 'joining':
        title.textContent = `Joining ${state.code ?? ''}`;
        busyText.textContent =
          state.step === 'loading' ? "Loading the host's world…" : 'Connecting to the host…';
        busyHint.textContent =
          state.step === 'loading'
            ? 'Almost there. The page may pause for a moment.'
            : 'If this takes long, a strict firewall may be in the way.';
        cancelButton.hidden = state.step === 'loading';
        break;
      case 'hosting':
        title.textContent = 'Your room';
        break;
      case 'joined':
        title.textContent = `Room ${state.code ?? ''}`;
        break;
      case 'ended':
        break;
    }

    // Alone.
    if (document.activeElement !== nameInput) nameInput.value = state.name;
    joinButton.disabled = false;

    // In a room.
    if (inRoom) {
      const hosting = state.status === 'hosting';
      codeBlock.hidden = !state.code;
      codeBig.textContent = state.code ?? '';
      const link = currentLink();
      if (document.activeElement !== linkField) linkField.value = link;
      roster.update(state.roster, state.localId);
      roomHint.textContent = hosting
        ? 'Friends type the code on this screen, or open the invite link. Keep this tab open: if you leave, the session ends for everyone. There is no host migration yet.'
        : 'If the host leaves, the session ends for everyone. There is no host migration yet.';
      offline.hidden = !(hosting && !state.roomOnline);
      leaveButton.textContent = hosting ? 'Close room' : 'Leave room';
    }

    // Failure notice on the card.
    const showNotice = state.status === 'alone' && state.notice !== null;
    notice.hidden = !showNotice;
    if (showNotice && state.notice) {
      noticeTitle.textContent = state.notice.title;
      noticeDetail.textContent = state.notice.detail;
    }

    // The mini roster.
    if (inRoom) {
      miniCode.textContent = state.code ? `Room ${state.code}` : '';
      miniRoster.update(state.roster, state.localId);
    }

    // The ended screen. A bad code typed there is explained under the field.
    if (state.ended) {
      endedTitle.textContent = state.ended.title;
      endedDetail.textContent = state.ended.detail;
    }
    endedNotice.hidden = !(state.ended && state.notice);
    if (state.ended && state.notice) {
      endedNotice.textContent = `${state.notice.title}. ${state.notice.detail}`;
    }
    announce(state);
    renderFold();

    const justEnded = state.status === 'ended' && lastStatus !== 'ended';
    lastStatus = state.status;
    lastNotice = state.notice;
    if (justEnded) {
      options.releaseMouse();
      later(0, () => endedAlone.focus());
    }
  }

  fold.addEventListener('click', () => {
    foldedByPlayer = true;
    folded = !folded;
    renderFold();
  });

  const submitOnEnter = (input: HTMLInputElement, submit: () => void): void => {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    });
  };
  submitOnEnter(codeInput, () => lobby.join(codeInput.value));
  submitOnEnter(endedCode, () => lobby.join(endedCode.value));
  submitOnEnter(nameInput, () => nameInput.blur());
  nameInput.addEventListener('change', () => {
    lobby.setName(nameInput.value);
    nameInput.value = lobby.state.name;
  });
  // Typing in a field must never leave the keyboard to the game when the mouse is taken back.
  const releaseFocus = (): void => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && root.contains(active)) active.blur();
  };

  const stopLobby = lobby.onChange(render);
  const stopPlaying = options.onPlayingChange(() => {
    if (options.isPlaying()) releaseFocus();
    render();
  });
  const onResize = (): void => {
    if (!foldedByPlayer) {
      folded = window.innerWidth < foldBelow;
      renderFold();
    }
  };
  window.addEventListener('resize', onResize);

  render();

  return {
    element: root,
    dispose() {
      stopLobby();
      stopPlaying();
      window.removeEventListener('resize', onResize);
      for (const handle of timers) window.clearTimeout(handle);
      timers.clear();
      if (armed !== null) window.clearTimeout(armed);
      if (copiedTimer !== null) window.clearTimeout(copiedTimer);
      root.remove();
    },
  };
}
