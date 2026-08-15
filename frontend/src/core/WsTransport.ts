/**
 * @file WsTransport.ts
 * @brief WebSocket transport for the Tether viewer RPC protocol.
 *
 * Implements a binary protobuf-over-WebSocket RPC protocol inspired by
 * the Noxeco NoxvisionEnvelope pattern. Uses a single envelope message
 * with a oneof discriminator (auth/request/response/cancel) sent as raw
 * binary protobuf in WebSocket binary frames.
 */

import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  TetherViewerEnvelopeSchema,
  AuthRequestSchema,
  CancelRequestSchema,
  TetherViewerRequestSchema,
  TetherViewerResponseSchema,
  type TetherViewerEnvelope,
  type TetherViewerRequest,
  type TetherViewerResponse,
} from '../generated/tether_viewer_pb';

export type WsConnectionState = 'disconnected' | 'connecting' | 'connected';

export class ViewerRpcError extends Error {
  constructor(message: string, public readonly code: number) {
    super(message);
    this.name = 'ViewerRpcError';
  }
}

interface PendingCall {
  callId: number;
  requestCase: string;
  requestBytes: Uint8Array;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  streamQueue: any[];
  streamNotify?: () => void;
  streamDone: boolean;
  isStreaming: boolean;
  startTime: number;
  sentTime: number;
  messageReceivedTime: number;
  resolveCalledTime: number;
}

let callIdCounter = 0;

export class WsTransport {
  private ws: WebSocket | null = null;
  private connectPromise: Promise<WebSocket> | null = null;
  private readonly pendingCalls = new Map<number, PendingCall>();
  private reconnectDelay = 1000;
  private readonly maxReconnectDelay = 30000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyClosed = false;

  onConnectionStateChange?: (state: WsConnectionState) => void;

  constructor(
    private readonly url: string,
    private readonly tokenGetter?: () => string | null,
    private readonly slowRequestThresholdMs: number = 150,
  ) {}

  /** Public read-only access to the URL for deriving HTTP endpoints. */
  get baseUrl(): string { return this.url; }

  private resolveWsUrl(): string {
    if (this.url.startsWith('ws://') || this.url.startsWith('wss://')) return this.url;
    if (this.url.startsWith('http://')) return 'ws://' + this.url.slice(7);
    if (this.url.startsWith('https://')) return 'wss://' + this.url.slice(8);
    const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = typeof window !== 'undefined' ? window.location.host : 'localhost';
    return `${protocol}//${host}${this.url.startsWith('/') ? '' : '/'}${this.url}`;
  }

  private setConnectionState(state: WsConnectionState): void {
    this.onConnectionStateChange?.(state);
  }

  private ensureConnected(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
    if (this.connectPromise) return this.connectPromise;
    this.intentionallyClosed = false;
    this.setConnectionState('connecting');
    this.connectPromise = new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(this.resolveWsUrl());
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        this.ws = ws;
        this.connectPromise = null;
        this.reconnectDelay = 1000;
        this.sendAuth(ws);
        for (const [, call] of this.pendingCalls) {
          ws.send(call.requestBytes);
        }
        this.setConnectionState('connected');
        resolve(ws);
      };

      ws.onerror = () => {
        this.connectPromise = null;
        reject(new ViewerRpcError('WebSocket failed', 14));
      };

      ws.onmessage = (e) => this.handleMessage(e);

      ws.onclose = () => {
        this.ws = null;
        this.connectPromise = null;
        this.setConnectionState('disconnected');
        if (!this.intentionallyClosed) {
          this.scheduleReconnect();
        }
      };
    });
    return this.connectPromise;
  }

  private sendAuth(ws: WebSocket): void {
    const token = this.tokenGetter?.() ?? null;
    const authEnv = create(TetherViewerEnvelopeSchema, {
      envelope: { case: 'auth', value: create(AuthRequestSchema, { token: token ?? '' }) },
    });
    ws.send(toBinary(TetherViewerEnvelopeSchema, authEnv));
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.setConnectionState('connecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.ensureConnected().catch(() => {});
    }, this.reconnectDelay);
  }

  private handleMessage(event: MessageEvent): void {
    if (!(event.data instanceof ArrayBuffer)) return;
    const messageReceivedTime = performance.now();
    const bytes = new Uint8Array(event.data);
    let envelope: TetherViewerEnvelope;
    try {
      envelope = fromBinary(TetherViewerEnvelopeSchema, bytes);
    } catch (e) {
      return;
    }
    if (envelope.envelope.case !== 'response') return;

    const response = envelope.envelope.value as TetherViewerResponse;
    const call = this.pendingCalls.get(response.callId);
    if (!call) return;

    call.messageReceivedTime = messageReceivedTime;

    if (response.errorMessage) {
      call.reject(new ViewerRpcError(`[Server] ${response.errorMessage}`, response.errorCode || 2));
      this.pendingCalls.delete(response.callId);
      return;
    }

    const responseValue = response.response.case !== undefined ? response.response.value : undefined;

    if (response.done) {
      if (call.isStreaming) {
        call.streamDone = true;
        call.streamNotify?.();
      } else if (responseValue !== undefined) {
        call.resolveCalledTime = performance.now();
        call.resolve(responseValue);
      } else {
        call.reject(new ViewerRpcError('Empty response', 2));
      }
      this.pendingCalls.delete(response.callId);
      return;
    }

    if (responseValue === undefined) {
      call.reject(new ViewerRpcError('Empty response', 2));
      this.pendingCalls.delete(response.callId);
      return;
    }

    if (call.isStreaming) {
      call.streamQueue.push(responseValue);
      call.streamNotify?.();
    } else {
      call.resolveCalledTime = performance.now();
      call.resolve(responseValue);
      this.pendingCalls.delete(response.callId);
    }
  }

  private sendBinary(bytes: Uint8Array, onSent?: () => void): Promise<void> {
    return this.ensureConnected().then((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(bytes);
        onSent?.();
      }
    });
  }

  private sendCancel(callId: number): void {
    const cancelEnv = create(TetherViewerEnvelopeSchema, {
      envelope: { case: 'cancel', value: create(CancelRequestSchema, { callId }) },
    });
    this.sendBinary(toBinary(TetherViewerEnvelopeSchema, cancelEnv)).catch(() => {});
  }

  async unary(
    requestCase: string,
    requestValue: any,
    signal?: AbortSignal,
  ): Promise<any> {
    const callId = ++callIdCounter;
    const request = create(TetherViewerRequestSchema, {
      callId,
      request: { case: requestCase as any, value: requestValue },
    });
    const envelope = create(TetherViewerEnvelopeSchema, {
      envelope: { case: 'request', value: request },
    });
    const bytes = toBinary(TetherViewerEnvelopeSchema, envelope);

    const startTime = performance.now();
    const call: PendingCall = {
      callId, requestCase, requestBytes: bytes,
      resolve: () => {}, reject: () => {},
      isStreaming: false, streamQueue: [], streamDone: false,
      startTime, sentTime: 0, messageReceivedTime: 0, resolveCalledTime: 0,
    };
    const promise = new Promise<any>((resolve, reject) => {
      call.resolve = resolve;
      call.reject = reject;
    });
    this.pendingCalls.set(callId, call);

    this.sendBinary(bytes, () => { call.sentTime = performance.now(); }).catch(() => {});

    signal?.addEventListener('abort', () => {
      this.sendCancel(callId);
      this.pendingCalls.delete(callId);
      call.reject(new ViewerRpcError('Aborted', 4));
    });

    return promise.finally(() => this.pendingCalls.delete(callId));
  }

  async *serverStream(
    requestCase: string,
    requestValue: any,
    signal?: AbortSignal,
  ): AsyncGenerator<any> {
    const callId = ++callIdCounter;
    const request = create(TetherViewerRequestSchema, {
      callId,
      request: { case: requestCase as any, value: requestValue },
    });
    const envelope = create(TetherViewerEnvelopeSchema, {
      envelope: { case: 'request', value: request },
    });
    const bytes = toBinary(TetherViewerEnvelopeSchema, envelope);

    const call: PendingCall = {
      callId, requestCase, requestBytes: bytes,
      resolve: () => {}, reject: () => {},
      isStreaming: true, streamQueue: [], streamDone: false,
      startTime: performance.now(), sentTime: 0, messageReceivedTime: 0, resolveCalledTime: 0,
    };
    let streamError: any = null;
    call.reject = (e: any) => { streamError = e; call.streamDone = true; call.streamNotify?.(); };
    call.resolve = () => {};

    this.pendingCalls.set(callId, call);
    this.sendBinary(bytes).catch(() => {});

    signal?.addEventListener('abort', () => {
      this.sendCancel(callId);
      streamError = new ViewerRpcError('Aborted', 4);
      call.streamDone = true;
      call.streamNotify?.();
    });

    try {
      while (!call.streamDone) {
        if (call.streamQueue.length === 0) {
          await new Promise<void>(r => { call.streamNotify = r; });
          call.streamNotify = undefined;
        }
        if (streamError) throw streamError;
        while (call.streamQueue.length > 0) {
          yield call.streamQueue.shift()!;
        }
      }
      if (streamError) throw streamError;
    } finally {
      this.pendingCalls.delete(callId);
    }
  }

  reauth(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendAuth(this.ws);
    }
  }

  close(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    for (const [, call] of this.pendingCalls) {
      call.reject(new ViewerRpcError('Closed', 14));
    }
    this.pendingCalls.clear();
    this.setConnectionState('disconnected');
  }
}
