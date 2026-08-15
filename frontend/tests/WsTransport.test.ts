/**
 * @file WsTransport.test.ts
 * @brief Unit tests for WsTransport using a mock WebSocket.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WsTransport, ViewerRpcError } from '../src/core/WsTransport';

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  binaryType: string = 'arraybuffer';
  readyState: number = 0; // CONNECTING
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  sentMessages: Uint8Array[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    // Simulate async connection
    setTimeout(() => {
      this.readyState = 1; // OPEN
      this.onopen?.(new Event('open'));
    }, 0);
  }

  send(data: Uint8Array): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = 3; // CLOSED
    this.onclose?.(new CloseEvent('close'));
  }

  // Helper to simulate receiving a message
  receive(data: Uint8Array): void {
    this.onmessage?.({ data: data.buffer } as MessageEvent);
  }
}

// Patch global WebSocket
const globalWebSocket = global.WebSocket;
beforeEach(() => {
  MockWebSocket.instances = [];
  (global as any).WebSocket = MockWebSocket;
});
afterEach(() => {
  (global as any).WebSocket = globalWebSocket;
});

describe('WsTransport', () => {
  it('connects and sends auth on open', async () => {
    const transport = new WsTransport('ws://localhost:8080/api/ws');
    const stateSpy = vi.fn();
    transport.onConnectionStateChange = stateSpy;
    await transport['ensureConnected']();
    await new Promise(r => setTimeout(r, 10));
    expect(MockWebSocket.instances.length).toBe(1);
    expect(MockWebSocket.instances[0].sentMessages.length).toBe(1); // auth message
  });

  it('resolves unary call on response', async () => {
    const transport = new WsTransport('ws://localhost:8080/api/ws');
    await transport['ensureConnected']();
    await new Promise(r => setTimeout(r, 10));

    // Make a unary call (don't await yet)
    const promise = transport.unary('ping', {});
    // Wait for the async send to complete
    await new Promise(r => setTimeout(r, 50));

    // The transport should have sent the request
    const ws = MockWebSocket.instances[0];
    expect(ws.sentMessages.length).toBeGreaterThanOrEqual(2); // auth + request

    // Simulate server response with callId=1
    const { create, toBinary } = await import('@bufbuild/protobuf');
    const { TetherViewerEnvelopeSchema, TetherViewerResponseSchema, PingResponseSchema } =
      await import('../src/generated/tether_viewer_pb');

    const response = create(TetherViewerResponseSchema, {
      callId: 1, done: true,
      response: { case: 'ping', value: create(PingResponseSchema, { timestamp: 123 }) },
    });
    const envelope = create(TetherViewerEnvelopeSchema, {
      envelope: { case: 'response', value: response },
    });
    ws.receive(toBinary(TetherViewerEnvelopeSchema, envelope));

    const result = await promise;
    expect(result.timestamp).toBe(123);
  });

  it('rejects on error response', async () => {
    const transport = new WsTransport('ws://localhost:8080/api/ws');
    await transport['ensureConnected']();
    await new Promise(r => setTimeout(r, 10));

    const promise = transport.unary('ping', {});
    await new Promise(r => setTimeout(r, 10));

    const { create, toBinary } = await import('@bufbuild/protobuf');
    const { TetherViewerEnvelopeSchema, TetherViewerResponseSchema } =
      await import('../src/generated/tether_viewer_pb');

    const response = create(TetherViewerResponseSchema, {
      callId: 2, done: true, errorMessage: 'Test error', errorCode: 13,
    });
    const envelope = create(TetherViewerEnvelopeSchema, {
      envelope: { case: 'response', value: response },
    });
    MockWebSocket.instances[0].receive(toBinary(TetherViewerEnvelopeSchema, envelope));

    await expect(promise).rejects.toThrow('Test error');
  });

  it('close rejects pending calls', async () => {
    const transport = new WsTransport('ws://localhost:8080/api/ws');
    await transport['ensureConnected']();
    await new Promise(r => setTimeout(r, 10));

    const promise = transport.unary('ping', {});
    await new Promise(r => setTimeout(r, 10));

    transport.close();
    await expect(promise).rejects.toThrow('Closed');
  });

  it('resolves ws URL from http://', () => {
    const transport = new WsTransport('http://localhost:8080/api/ws');
    expect(transport['resolveWsUrl']()).toBe('ws://localhost:8080/api/ws');
  });

  it('resolves ws URL from https://', () => {
    const transport = new WsTransport('https://localhost:8080/api/ws');
    expect(transport['resolveWsUrl']()).toBe('wss://localhost:8080/api/ws');
  });
});
