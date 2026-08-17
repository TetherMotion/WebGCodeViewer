/**
 * @file EventDispatcher.ts
 * @brief Simple typed event dispatcher for viewer UI events.
 */

export type EventHandler<T = any> = (payload: T) => void;

export class EventDispatcher<TEventMap extends Record<string, any> = Record<string, any>> {
  private handlers = new Map<keyof TEventMap, Set<EventHandler>>();

  on<K extends keyof TEventMap>(event: K, handler: EventHandler<TEventMap[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as EventHandler);
    return () => this.off(event, handler);
  }

  off<K extends keyof TEventMap>(event: K, handler: EventHandler<TEventMap[K]>): void {
    const set = this.handlers.get(event);
    if (set) {
      set.delete(handler as EventHandler);
      if (set.size === 0) {
        this.handlers.delete(event);
      }
    }
  }

  emit<K extends keyof TEventMap>(event: K, payload: TEventMap[K]): void {
    const set = this.handlers.get(event);
    if (set) {
      for (const handler of set) {
        try {
          handler(payload);
        } catch (e) {
          console.error(`[EventDispatcher] Error in handler for "${String(event)}":`, e);
        }
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
