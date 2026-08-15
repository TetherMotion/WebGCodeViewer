/**
 * @file RpcClient.test.ts
 * @brief Unit tests for RpcClient.
 */

import { describe, it, expect, vi } from 'vitest';
import { RpcClient } from '../src/core/RpcClient';

// Create a mock transport with spy functions
function createMockTransport() {
  const calls: { case: string; value: any }[] = [];
  const transport = {
    baseUrl: '/api/ws',
    unary: vi.fn(async (requestCase: string, requestValue: any) => {
      calls.push({ case: requestCase, value: requestValue });
      // Return mock responses based on request case
      if (requestCase === 'uploadGcode') return { jobId: 'test-123', state: 'pending' };
      if (requestCase === 'processJob') return { jobId: 'test-123', state: 'processing' };
      if (requestCase === 'getJobStatus') return { jobId: 'test-123', state: 'ready', progress: 1.0 };
      if (requestCase === 'getBinary') return { data: new Uint8Array(96) };
      if (requestCase === 'getBlocks') return { blocks: [] };
      if (requestCase === 'getStatistics') return { duration: 10, sampleCount: 100 };
      if (requestCase === 'getSegments') return { segments: [] };
      if (requestCase === 'listJobs') return { jobs: [] };
      if (requestCase === 'deleteJob') return { deleted: true };
      if (requestCase === 'getZLayers') return { layers: [], totalLayers: 0 };
      if (requestCase === 'getZLayerBinary') return { data: new Uint8Array(96) };
      if (requestCase === 'getZLayerRangeBinary') return { data: new Uint8Array(96) };
      if (requestCase === 'ping') return { timestamp: 123 };
      if (requestCase === 'getVersion') return { version: '1.0.0' };
      return {};
    }),
    serverStream: vi.fn(),
    close: vi.fn(),
    reauth: vi.fn(),
  };
  return { transport, calls };
}

describe('RpcClient', () => {
  it('uploadGcode calls transport.unary with uploadGcode case', async () => {
    const { transport } = createMockTransport();
    const client = new RpcClient(transport as any);
    const result = await client.uploadGcode('G1 X10', 'test.gcode');
    expect(transport.unary).toHaveBeenCalledWith('uploadGcode', expect.anything());
    expect(result.jobId).toBe('test-123');
  });

  it('processJob calls transport.unary with processJob case', async () => {
    const { transport } = createMockTransport();
    const client = new RpcClient(transport as any);
    await client.processJob('job-1', { sampleRate: 0.01 });
    expect(transport.unary).toHaveBeenCalledWith('processJob', expect.anything());
  });

  it('getJobStatus calls transport.unary with getJobStatus case', async () => {
    const { transport } = createMockTransport();
    const client = new RpcClient(transport as any);
    await client.getJobStatus('job-1');
    expect(transport.unary).toHaveBeenCalledWith('getJobStatus', expect.anything());
  });

  it('getBinary calls transport.unary with getBinary case', async () => {
    const { transport } = createMockTransport();
    const client = new RpcClient(transport as any);
    await client.getBinary('job-1', { fields: 0x0001, downsample: 10 });
    expect(transport.unary).toHaveBeenCalledWith('getBinary', expect.anything());
  });

  it('getZLayers calls transport.unary with getZLayers case', async () => {
    const { transport } = createMockTransport();
    const client = new RpcClient(transport as any);
    await client.getZLayers('job-1', 0.05);
    expect(transport.unary).toHaveBeenCalledWith('getZLayers', expect.anything());
  });

  it('deleteJob calls transport.unary with deleteJob case', async () => {
    const { transport } = createMockTransport();
    const client = new RpcClient(transport as any);
    await client.deleteJob('job-1');
    expect(transport.unary).toHaveBeenCalledWith('deleteJob', expect.anything());
  });

  it('ping calls transport.unary with ping case', async () => {
    const { transport } = createMockTransport();
    const client = new RpcClient(transport as any);
    const result = await client.ping();
    expect(transport.unary).toHaveBeenCalledWith('ping', expect.anything());
    expect(result.timestamp).toBe(123);
  });

  it('getVersion calls transport.unary with getVersion case', async () => {
    const { transport } = createMockTransport();
    const client = new RpcClient(transport as any);
    const result = await client.getVersion();
    expect(transport.unary).toHaveBeenCalledWith('getVersion', expect.anything());
    expect(result.version).toBe('1.0.0');
  });

  it('close calls transport.close', () => {
    const { transport } = createMockTransport();
    const client = new RpcClient(transport as any);
    client.close();
    expect(transport.close).toHaveBeenCalled();
  });

  it('getZLayerBinary passes layer index', async () => {
    const { transport } = createMockTransport();
    const client = new RpcClient(transport as any);
    await client.getZLayerBinary('job-1', 5);
    expect(transport.unary).toHaveBeenCalledWith('getZLayerBinary', expect.anything());
  });

  it('getZLayerRangeBinary passes layer range', async () => {
    const { transport } = createMockTransport();
    const client = new RpcClient(transport as any);
    await client.getZLayerRangeBinary('job-1', 2, 5);
    expect(transport.unary).toHaveBeenCalledWith('getZLayerRangeBinary', expect.anything());
  });

  it('listJobs calls transport.unary with listJobs case', async () => {
    const { transport } = createMockTransport();
    const client = new RpcClient(transport as any);
    const result = await client.listJobs();
    expect(transport.unary).toHaveBeenCalledWith('listJobs', expect.anything());
    expect(result.jobs).toEqual([]);
  });

  it('getZLayersHttp fetches z-layers via HTTP and returns JSON', async () => {
    const { transport } = createMockTransport();
    const client = new RpcClient(transport as any);
    const mockLayers = {
      layers: [{ layerIndex: 0, zHeight: 0.2, pieceStart: 0, pieceEnd: 10, pieceCount: 1 }],
      totalLayers: 1,
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockLayers,
    } as Response);
    const result = await client.getZLayersHttp('job-1', 0.05);
    expect(fetchSpy).toHaveBeenCalledWith(
      `${client.httpBaseUrl}/api/trajectory/job-1/zlayers?zTolerance=0.05`,
    );
    expect(result.totalLayers).toBe(1);
    expect(result.layers.length).toBe(1);
    fetchSpy.mockRestore();
  });

  it('getZLayersHttp throws ViewerRpcError on non-ok response', async () => {
    const { transport } = createMockTransport();
    const client = new RpcClient(transport as any);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response);
    await expect(client.getZLayersHttp('job-1')).rejects.toThrow('HTTP 500');
    fetchSpy.mockRestore();
  });
});
