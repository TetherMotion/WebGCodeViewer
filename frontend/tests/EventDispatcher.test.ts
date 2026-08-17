/**
 * @file EventDispatcher.test.ts
 * @brief Unit tests for EventDispatcher.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventDispatcher } from "@tether/viewer-core";

interface TestEvents {
  foo: number;
  bar: string;
}

describe('EventDispatcher', () => {
  it('calls handler on emit', () => {
    const dispatcher = new EventDispatcher<TestEvents>();
    const handler = vi.fn();
    dispatcher.on('foo', handler);
    dispatcher.emit('foo', 42);
    expect(handler).toHaveBeenCalledWith(42);
  });

  it('supports multiple handlers', () => {
    const dispatcher = new EventDispatcher<TestEvents>();
    const h1 = vi.fn();
    const h2 = vi.fn();
    dispatcher.on('bar', h1);
    dispatcher.on('bar', h2);
    dispatcher.emit('bar', 'hello');
    expect(h1).toHaveBeenCalledWith('hello');
    expect(h2).toHaveBeenCalledWith('hello');
  });

  it('off removes handler', () => {
    const dispatcher = new EventDispatcher<TestEvents>();
    const handler = vi.fn();
    dispatcher.on('foo', handler);
    dispatcher.off('foo', handler);
    dispatcher.emit('foo', 1);
    expect(handler).not.toHaveBeenCalled();
  });

  it('on returns unsubscribe function', () => {
    const dispatcher = new EventDispatcher<TestEvents>();
    const handler = vi.fn();
    const unsub = dispatcher.on('foo', handler);
    dispatcher.emit('foo', 1);
    expect(handler).toHaveBeenCalledTimes(1);
    unsub();
    dispatcher.emit('foo', 2);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('clear removes all handlers', () => {
    const dispatcher = new EventDispatcher<TestEvents>();
    const h1 = vi.fn();
    const h2 = vi.fn();
    dispatcher.on('foo', h1);
    dispatcher.on('bar', h2);
    dispatcher.clear();
    dispatcher.emit('foo', 1);
    dispatcher.emit('bar', 'x');
    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  it('handler errors are caught', () => {
    const dispatcher = new EventDispatcher<TestEvents>();
    const errorHandler = vi.fn(() => { throw new Error('boom'); });
    const normalHandler = vi.fn();
    dispatcher.on('foo', errorHandler);
    dispatcher.on('foo', normalHandler);
    // Should not throw
    expect(() => dispatcher.emit('foo', 1)).not.toThrow();
    expect(normalHandler).toHaveBeenCalled();
  });
});
