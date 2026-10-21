import type { Unsubscribe } from './session';

/** A set of listeners. A listener that throws is reported and skipped, so one bad handler cannot stall the network code. */
export class Emitter<T> {
  private readonly listeners = new Set<(value: T) => void>();

  on(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(value: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(value);
      } catch (error) {
        console.error(error);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
