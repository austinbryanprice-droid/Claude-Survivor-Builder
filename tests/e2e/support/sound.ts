import { expect, type Page } from '@playwright/test';

/**
 * What the browser tests read in place of listening: the sound of the valley reports each sound it
 * starts (`window.__ashbound.sound.events`) with the kind of effect it belongs to and where it placed
 * it between the speakers. Nothing here needs speakers.
 */

export const STATE_TIMEOUT = 60_000;
/** `expect.poll` with the patience of software WebGL: the HUD and the sound only change when a frame is drawn. */
export const poll = <T>(read: () => Promise<T>) => expect.poll(read, { timeout: STATE_TIMEOUT });

/** One sound an effect started: which voice, which kind of effect it belongs to, and where it was placed. */
export interface Heard {
  name: string;
  effect: string;
  /** -1 is hard left and 1 hard right. */
  pan: number;
  /** Decibels, once the distance had taken its share. */
  level: number;
}

/** Clicks Play, which unlocks the audio and takes the mouse, and waits for the sound to start its long sounds. */
export async function play(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('#hud')).toHaveAttribute('data-pointer', 'locked', {
    timeout: STATE_TIMEOUT,
  });
  await poll(() => page.evaluate(() => window.__ashbound?.sound?.live?.stats.beds ?? 0)).toBe(3);
}

/** Every sound the effects have started so far, in order. */
export const heard = (page: Page): Promise<Heard[]> =>
  page.evaluate(() =>
    (window.__ashbound?.sound?.events ?? []).flatMap((event) =>
      event.effect === undefined
        ? []
        : [
            {
              name: event.name,
              effect: event.effect as string,
              pan: event.pan ?? 0,
              level: event.level ?? 0,
            },
          ],
    ),
  );

/** The sounds of one kind of effect since `from` sounds had been heard. */
export async function since(page: Page, from: number, effect: string): Promise<Heard[]> {
  return (await heard(page)).slice(from).filter((sound) => sound.effect === effect);
}

/** Waits for a sound of this kind of effect to start after `from`, and returns the ones that have. */
export async function hearEffect(page: Page, from: number, effect: string): Promise<Heard[]> {
  try {
    await poll(async () => (await since(page, from, effect)).length).toBeGreaterThan(0);
  } catch (error) {
    const sofar = (await heard(page)).slice(from).map((sound) => `${sound.effect}:${sound.name}`);
    const refused = await page.evaluate(() =>
      (window.__ashbound?.mp?.rejections() ?? []).map((rejection) => rejection.reason),
    );
    const stats = await page.evaluate(() => JSON.stringify(window.__ashbound?.sound?.live?.stats));
    throw new Error(
      `no "${effect}" sound after the first ${from}; heard since: ${sofar.join(', ') || 'nothing'}; the host refused: ${refused.join('; ') || 'nothing'}; the sound's own count: ${stats}`,
      { cause: error },
    );
  }
  return since(page, from, effect);
}

/** Turns the player to face `yaw` and waits until the sound has been told, which it is once a frame. */
export async function face(page: Page, yaw: number): Promise<void> {
  await page.evaluate(
    (yaw) =>
      new Promise<void>((resolve) => {
        const game = window.__ashbound?.game;
        if (!game) return resolve();
        game.look.yaw = yaw;
        let seen = 0;
        const stop = game.onFrame(() => {
          if (++seen >= 2) {
            stop();
            resolve();
          }
        });
      }),
    yaw,
  );
}

/** The names of the voices of some sounds, in the order they started. */
export const names = (sounds: readonly Heard[]): string[] => sounds.map((sound) => sound.name);

/** Lets `seconds` go by on the audio clock, which is the clock the sound keeps its gaps and its budget by. */
export async function pause(page: Page, seconds: number): Promise<void> {
  const from = await page.evaluate(() => window.__ashbound?.audio?.hub.context?.currentTime ?? 0);
  await page.waitForFunction(
    ([from, seconds]) =>
      (window.__ashbound?.audio?.hub.context?.currentTime ?? 0) >= from! + seconds!,
    [from, seconds] as const,
    { timeout: STATE_TIMEOUT },
  );
}
