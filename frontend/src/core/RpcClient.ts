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

  constructor(transport: WsTransport) {
    this.transport = transport;
  }

  async uploadGcode(gcodeText: string, filename: string = ''): Promise<UploadGcodeResponse> {
    return this.transport.unary(
      'uploadGcode',
      create(UploadGcodeRequestSchema, { gcodeText, filename }),
    );
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
