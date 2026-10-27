import type { Unsubscribe } from './session';

/**
 * A set of listeners. A listener that throws is reported and skipped, so one bad handler cannot stall the network code.
 * What an emit carries beyond its value (`Rest`) is handed to every listener after it.
 */
export class Emitter<T, Rest extends unknown[] = []> {
  private readonly listeners = new Set<(value: T, ...rest: Rest) => void>();

  on(listener: (value: T, ...rest: Rest) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(value: T, ...rest: Rest): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(value, ...rest);
      } catch (error) {
        console.error(error);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
