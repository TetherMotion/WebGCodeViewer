/**
 * @file RpcClient.ts
 * @brief Typed RPC client for the Tether viewer protocol.
 * Wraps WsTransport with typed methods for each RPC.
 */

import { create, type Message } from '@bufbuild/protobuf';
import { EmptySchema } from '@bufbuild/protobuf/wkt';
import { WsTransport, ViewerRpcError } from './WsTransport';
import {
  UploadGcodeRequestSchema,
  UploadGcodeResponseSchema,
  ProcessJobRequestSchema,
  ProcessJobResponseSchema,
  GetJobStatusRequestSchema,
  GetJobStatusResponseSchema,
  GetBinaryRequestSchema,
  BinaryDataResponseSchema,
  GetBlocksRequestSchema,
  GetBlocksResponseSchema,
  GetStatisticsRequestSchema,
  GetStatisticsResponseSchema,
  GetSegmentsRequestSchema,
  GetSegmentsResponseSchema,
  ListJobsRequestSchema,
  ListJobsResponseSchema,
  DeleteJobRequestSchema,
  DeleteJobResponseSchema,
  GetZLayersRequestSchema,
  GetZLayersResponseSchema,
  GetZLayerBinaryRequestSchema,
  GetZLayerRangeBinaryRequestSchema,
  PingResponseSchema,
  VersionResponseSchema,
  type UploadGcodeResponse,
  type ProcessJobResponse,
  type GetJobStatusResponse,
  type BinaryDataResponse,
  type GetBlocksResponse,
  type GetStatisticsResponse,
  type GetSegmentsResponse,
  type ListJobsResponse,
  type DeleteJobResponse,
  type GetZLayersResponse,
  type PingResponse,
  type VersionResponse,
} from '../generated/tether_viewer_pb';

export interface ProcessJobOptions {
  sampleRate?: number;
  maxVelocity?: number;
  maxAcceleration?: number;
  maxJerk?: number;
  strategy?: string;
}

export interface BinaryRequestOptions {
  fields?: number;
  axes?: number;
  startTime?: number;
  endTime?: number;
  segStart?: number;
  segEnd?: number;
  downsample?: number;
}

export class RpcClient {
  private readonly transport: WsTransport;
  private readonly httpBaseUrl: string;

  constructor(transport: WsTransport) {
    this.transport = transport;
    // Derive HTTP base URL from the WebSocket URL
    this.httpBaseUrl = RpcClient.deriveHttpBaseUrl(transport.baseUrl);
  }

  private static deriveHttpBaseUrl(wsUrl: string): string {
    // Convert ws/wss protocol to http/https
    let httpUrl: string;
    if (wsUrl.startsWith('ws://')) httpUrl = 'http://' + wsUrl.slice(5);
    else if (wsUrl.startsWith('wss://')) httpUrl = 'https://' + wsUrl.slice(6);
    else if (wsUrl.startsWith('http://') || wsUrl.startsWith('https://')) httpUrl = wsUrl;
    else if (typeof window !== 'undefined') {
      // Relative URL like "/api/ws" — use page origin
      return window.location.origin;
    } else {
      return 'http://localhost:8021';
    }
    // Strip path component — we need just the origin for REST API
    try {
      const u = new URL(httpUrl);
      return u.origin;
    } catch {
      return httpUrl;
    }
  }

  async uploadGcode(gcodeText: string, filename: string = ''): Promise<UploadGcodeResponse> {
    return this.transport.unary(
      'uploadGcode',
      create(UploadGcodeRequestSchema, { gcodeText, filename }),
    );
  }

  /**
   * Upload G-code via HTTP POST instead of WebSocket.
   * This bypasses protobuf's 2GB message size limit for very large G-code files.
   * Uses multipart/form-data to send the file.
   */
  async uploadGcodeHttp(file: File): Promise<UploadGcodeResponse> {
    const formData = new FormData();
    formData.append('file', file, file.name);

    const resp = await fetch(`${this.httpBaseUrl}/api/trajectory/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new ViewerRpcError(`Upload failed: HTTP ${resp.status}: ${text}`, resp.status);
    }
    const json = await resp.json() as { jobId: string; filename: string; state: string };
    // Return in the same shape as the WebSocket response
    return create(UploadGcodeResponseSchema, {
      jobId: json.jobId,
      filename: json.filename,
    });
  }

  async processJob(jobId: string, options: ProcessJobOptions = {}): Promise<ProcessJobResponse> {
    return this.transport.unary(
      'processJob',
      create(ProcessJobRequestSchema, {
        jobId,
        sampleRate: options.sampleRate ?? 0,
        maxVelocity: options.maxVelocity ?? 0,
        maxAcceleration: options.maxAcceleration ?? 0,
        maxJerk: options.maxJerk ?? 0,
        strategy: options.strategy ?? '',
      }),
    );
  }

  async getJobStatus(jobId: string): Promise<GetJobStatusResponse> {
    return this.transport.unary(
      'getJobStatus',
      create(GetJobStatusRequestSchema, { jobId }),
    );
  }

  async getBinary(jobId: string, options: BinaryRequestOptions = {}): Promise<BinaryDataResponse> {
    return this.transport.unary(
      'getBinary',
      create(GetBinaryRequestSchema, {
        jobId,
        fields: options.fields ?? 0,
        axes: options.axes ?? 0,
        startTime: options.startTime ?? 0,
        endTime: options.endTime ?? 0,
        segStart: options.segStart ?? -1,
        segEnd: options.segEnd ?? -1,
        downsample: options.downsample ?? 0,
      }),
    );
  }

  /**
   * Fetch binary TTHR data via HTTP instead of WebSocket.
   * This bypasses protobuf's 2GB message size limit, supporting
   * very large G-code files (>2GB serialized trajectory data).
   * Returns raw bytes that can be passed directly to parseTTHR().
   */
  async getBinaryHttp(jobId: string, options: BinaryRequestOptions = {}): Promise<Uint8Array> {
    const params = new URLSearchParams();
    if (options.fields) params.set('fields', String(options.fields));
    if (options.axes) params.set('axes', String(options.axes));
    if (options.startTime) params.set('start', String(options.startTime));
    if (options.endTime) params.set('end', String(options.endTime));
    if (options.segStart !== undefined && options.segStart >= 0) params.set('segStart', String(options.segStart));
    if (options.segEnd !== undefined && options.segEnd >= 0) params.set('segEnd', String(options.segEnd));
    if (options.downsample) params.set('downsample', String(options.downsample));

    const qs = params.toString();
    const url = `${this.httpBaseUrl}/api/trajectory/${jobId}/binary${qs ? '?' + qs : ''}`;

    const resp = await fetch(url);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new ViewerRpcError(`HTTP ${resp.status}: ${text || resp.statusText}`, resp.status);
    }

    const buf = await resp.arrayBuffer();
    return new Uint8Array(buf);
  }

  async getBlocks(jobId: string): Promise<GetBlocksResponse> {
    return this.transport.unary(
      'getBlocks',
      create(GetBlocksRequestSchema, { jobId }),
    );
  }

  async getStatistics(jobId: string): Promise<GetStatisticsResponse> {
    return this.transport.unary(
      'getStatistics',
      create(GetStatisticsRequestSchema, { jobId }),
    );
  }

  async getSegments(jobId: string): Promise<GetSegmentsResponse> {
    return this.transport.unary(
      'getSegments',
      create(GetSegmentsRequestSchema, { jobId }),
    );
  }

  async listJobs(): Promise<ListJobsResponse> {
    return this.transport.unary(
      'listJobs',
      create(ListJobsRequestSchema, {}),
    );
  }

  async deleteJob(jobId: string): Promise<DeleteJobResponse> {
    return this.transport.unary(
      'deleteJob',
      create(DeleteJobRequestSchema, { jobId }),
    );
  }

  async getZLayers(jobId: string, zTolerance: number = 0.01): Promise<GetZLayersResponse> {
    return this.transport.unary(
      'getZLayers',
      create(GetZLayersRequestSchema, { jobId, zTolerance }),
    );
  }

  async getZLayerBinary(jobId: string, layerIndex: number, fields: number = 0, axes: number = 0): Promise<BinaryDataResponse> {
    return this.transport.unary(
      'getZLayerBinary',
      create(GetZLayerBinaryRequestSchema, { jobId, layerIndex, fields, axes }),
    );
  }

  async getZLayerRangeBinary(jobId: string, startLayer: number, endLayer: number, fields: number = 0, axes: number = 0): Promise<BinaryDataResponse> {
    return this.transport.unary(
      'getZLayerRangeBinary',
      create(GetZLayerRangeBinaryRequestSchema, { jobId, startLayer, endLayer, fields, axes }),
    );
  }

  async ping(): Promise<PingResponse> {
    return this.transport.unary('ping', create(EmptySchema, {}));
  }

  async getVersion(): Promise<VersionResponse> {
    return this.transport.unary('getVersion', create(EmptySchema, {}));
  }

  close(): void {
    this.transport.close();
  }
}
