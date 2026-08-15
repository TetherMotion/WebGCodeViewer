/**
 * @file PrinterFrameRenderer.ts
 * @brief WebGPU renderer for a full printer frame stand-in model.
 *
 * Renders a Cartesian-style 3D printer frame with:
 *   - 4 vertical columns (frame)
 *   - Build plate (rectangle at the bottom)
 *   - X-axis gantry beam (moves in Y)
 *   - Extruder carriage (moves in X along the gantry)
 *   - Extruder head/nozzle (moves in Z with the carriage)
 *
 * The extruder head position is set via setExtruderPosition(x, y, z).
 * The frame dimensions are set via setBounds(min, max) from the loaded
 * object's bounding box, so the printer frame always encloses the print.
 *
 * All geometry is rendered as line-list primitives for a clean technical look.
 */

import type { Mat4 } from '../core/MathUtils';

export class PrinterFrameRenderer {
  private pipeline: GPURenderPipeline | null = null;
  private staticBuffer: GPUBuffer | null = null;   // frame + plate (never moves)
  private dynamicBuffer: GPUBuffer | null = null;   // gantry + carriage + nozzle (moves)
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private staticVertexCount: number = 0;
  private dynamicVertexCount: number = 0;
  private buildPlateStart: number = 0;  // vertex index where build plate starts
  private buildPlateCount: number = 0;  // number of build plate vertices

  private visibleFlag: boolean = true;
  private extruderX: number = 0;
  private extruderY: number = 0;
  private extruderZ: number = 0;

  // Bed temperature for build plate color (0°C = gray, 100°C = red)
  private bedTemp: number = 0;

  // Printer frame dimensions (derived from the print's bounding box)
  private frameMin: [number, number, number] = [-100, -100, 0];
  private frameMax: [number, number, number] = [100, 100, 200];
  private margin: number = 20; // extra space around the print bounds

  get visible(): boolean { return this.visibleFlag; }
  set visible(v: boolean) { this.visibleFlag = v; }

  constructor(private device: GPUDevice) {}

  async init(format: GPUTextureFormat): Promise<void> {
    const shader = this.device.createShaderModule({
      code: `
        struct Uniforms {
          viewProj: mat4x4<f32>,
          color: vec4<f32>,
        };
        @group(0) @binding(0) var<uniform> uniforms: Uniforms;

        struct VertexInput {
          @location(0) position: vec3<f32>,
        };

        struct VertexOutput {
          @builtin(position) clipPosition: vec4<f32>,
        };

        @vertex
        fn vs_main(input: VertexInput) -> VertexOutput {
          var output: VertexOutput;
          output.clipPosition = uniforms.viewProj * vec4<f32>(input.position, 1.0);
          return output;
        }

        @fragment
        fn fs_main() -> @location(0) vec4<f32> {
          return uniforms.color;
        }
      `,
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shader,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 12,
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
        }],
      },
      fragment: {
        module: shader,
        entryPoint: 'fs_main',
        targets: [{
          format,
          blend: {
            alpha: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
          },
        }],
      },
      primitive: { topology: 'line-list' },
      depthStencil: {
        format: 'depth32float',
        depthCompare: 'less',
        depthWriteEnabled: true,
      },
    });

    this.uniformBuffer = this.device.createBuffer({
      size: 80, // 64 (viewProj) + 16 (color)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });

    // Pre-allocate dynamic buffer (worst-case size for gantry + carriage + nozzle)
    // Gantry: 2 lines (4 verts), Carriage: 4 lines (8 verts), Nozzle: 8 lines (16 verts) = 28 verts
    this.dynamicBuffer = this.device.createBuffer({
      size: 28 * 12, // 28 vertices × 12 bytes
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  /**
   * Set the printer frame dimensions from the print's bounding box.
   * The frame is sized to enclose the print with a margin.
   */
  setBounds(min: [number, number, number], max: [number, number, number]): void {
    this.frameMin = [
      min[0] - this.margin,
      min[1] - this.margin,
      min[2] - this.margin,
    ];
    this.frameMax = [
      max[0] + this.margin,
      max[1] + this.margin,
      max[2] + this.margin * 2, // extra Z room for the gantry above the print
    ];
    this.buildStaticGeometry();
  }

  /**
   * Set the extruder head position in world space.
   */
  setExtruderPosition(x: number, y: number, z: number): void {
    this.extruderX = x;
    this.extruderY = y;
    this.extruderZ = z;
    this.buildDynamicGeometry();
  }

  /**
   * Set the bed temperature for build plate color visualization.
   * 0°C = gray, 60°C = warm orange, 100°C+ = red.
   */
  setBedTemperature(temp: number): void {
    this.bedTemp = temp;
  }

  private buildStaticGeometry(): void {
    const [minX, minY, minZ] = this.frameMin;
    const [maxX, maxY, maxZ] = this.frameMax;

    const verts: number[] = [];

    // 4 vertical columns at the corners
    // Column 1: (minX, minY)
    verts.push(minX, minY, minZ,  minX, minY, maxZ);
    // Column 2: (maxX, minY)
    verts.push(maxX, minY, minZ,  maxX, minY, maxZ);
    // Column 3: (maxX, maxY)
    verts.push(maxX, maxY, minZ,  maxX, maxY, maxZ);
    // Column 4: (minX, maxY)
    verts.push(minX, maxY, minZ,  minX, maxY, maxZ);

    // Build plate (rectangle at z=minZ) — tracked separately for temperature coloring
    this.buildPlateStart = verts.length / 3;
    verts.push(minX, minY, minZ,  maxX, minY, minZ);
    verts.push(maxX, minY, minZ,  maxX, maxY, minZ);
    verts.push(maxX, maxY, minZ,  minX, maxY, minZ);
    verts.push(minX, maxY, minZ,  minX, minY, minZ);
    this.buildPlateCount = (verts.length / 3) - this.buildPlateStart;

    // Top frame (rectangle at z=maxZ)
    verts.push(minX, minY, maxZ,  maxX, minY, maxZ);
    verts.push(maxX, minY, maxZ,  maxX, maxY, maxZ);
    verts.push(maxX, maxY, maxZ,  minX, maxY, maxZ);
    verts.push(minX, maxY, maxZ,  minX, minY, maxZ);

    // Z-axis rails on the back two columns (visual guides for Z movement)
    // Already drawn as part of columns, but add subtle cross-bracing on the back
    verts.push(minX, maxY, minZ,  minX, maxY, maxZ); // already have this
    // Diagonal brace on back wall
    verts.push(minX, maxY, minZ,  maxX, maxY, maxZ * 0.7);
    verts.push(maxX, maxY, minZ,  minX, maxY, maxZ * 0.7);

    const data = new Float32Array(verts);
    this.staticVertexCount = verts.length / 3;

    if (!this.staticBuffer || this.staticBuffer.size < data.byteLength) {
      this.staticBuffer?.destroy();
      this.staticBuffer = this.device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }
    this.device.queue.writeBuffer(this.staticBuffer, 0, data);
  }

  private buildDynamicGeometry(): void {
    const [minX, minY, , ] = this.frameMin;
    const [maxX, maxY, , ] = this.frameMax;
    const x = this.extruderX;
    const y = this.extruderY;
    const z = this.extruderZ;

    const verts: number[] = [];

    // X-axis gantry beam: spans full X at the extruder's Y position, at the top
    const gantryZ = this.frameMax[2];
    verts.push(minX, y, gantryZ,  maxX, y, gantryZ);

    // Vertical drop from gantry to extruder carriage
    verts.push(x, y, gantryZ,  x, y, z + 30); // 30mm above nozzle for the carriage

    // Extruder carriage box (small cube ~20mm)
    const cs = 10; // half-size of carriage
    const cz = z + 30;
    // Bottom face
    verts.push(x - cs, y - cs, cz,  x + cs, y - cs, cz);
    verts.push(x + cs, y - cs, cz,  x + cs, y + cs, cz);
    verts.push(x + cs, y + cs, cz,  x - cs, y + cs, cz);
    verts.push(x - cs, y + cs, cz,  x - cs, y - cs, cz);
    // Top face
    const ct = cz + 20;
    verts.push(x - cs, y - cs, ct,  x + cs, y - cs, ct);
    verts.push(x + cs, y - cs, ct,  x + cs, y + cs, ct);
    verts.push(x + cs, y + cs, ct,  x - cs, y + cs, ct);
    verts.push(x - cs, y + cs, ct,  x - cs, y - cs, ct);
    // Vertical edges
    verts.push(x - cs, y - cs, cz,  x - cs, y - cs, ct);
    verts.push(x + cs, y - cs, cz,  x + cs, y - cs, ct);
    verts.push(x + cs, y + cs, cz,  x + cs, y + cs, ct);
    verts.push(x - cs, y + cs, cz,  x - cs, y + cs, ct);

    // Nozzle: cone shape from carriage bottom to tip
    const ns = 4; // nozzle half-width at top
    verts.push(x - ns, y - ns, cz,  x, y, z);
    verts.push(x + ns, y - ns, cz,  x, y, z);
    verts.push(x + ns, y + ns, cz,  x, y, z);
    verts.push(x - ns, y + ns, cz,  x, y, z);
    // Nozzle top ring
    verts.push(x - ns, y - ns, cz,  x + ns, y - ns, cz);
    verts.push(x + ns, y - ns, cz,  x + ns, y + ns, cz);
    verts.push(x + ns, y + ns, cz,  x - ns, y + ns, cz);
    verts.push(x - ns, y + ns, cz,  x - ns, y - ns, cz);

    const data = new Float32Array(verts);
    this.dynamicVertexCount = verts.length / 3;

    if (this.dynamicBuffer) {
      this.device.queue.writeBuffer(this.dynamicBuffer, 0, data);
    }
  }

  render(pass: GPURenderPassEncoder, viewProj: Mat4): void {
    if (!this.visibleFlag || !this.pipeline || !this.uniformBuffer || !this.bindGroup) return;

    // Compute build plate color from bed temperature
    // 0°C = gray (0.5, 0.5, 0.55), 60°C = warm orange (0.8, 0.5, 0.2), 100°C+ = red (0.9, 0.2, 0.1)
    const tempFactor = Math.min(1.0, this.bedTemp / 100);
    const plateR = 0.5 + tempFactor * 0.4;
    const plateG = 0.5 - tempFactor * 0.3;
    const plateB = 0.55 - tempFactor * 0.45;

    // Draw static frame (semi-transparent gray)
    if (this.staticBuffer && this.staticVertexCount > 0) {
      // Draw non-plate vertices in gray
      const nonPlateCount = this.staticVertexCount - this.buildPlateCount;
      if (nonPlateCount > 0) {
        const uniformData = new ArrayBuffer(80);
        const view = new Float32Array(uniformData);
        for (let i = 0; i < 16; i++) view[i] = viewProj[i];
        view[16] = 0.5; view[17] = 0.5; view[18] = 0.55; view[19] = 0.4; // gray, 40% alpha
        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.setVertexBuffer(0, this.staticBuffer);
        // Draw columns + top frame + braces (before build plate)
        pass.draw(this.buildPlateStart);
        // Draw vertices after build plate (top frame + braces)
        if (this.buildPlateStart + this.buildPlateCount < this.staticVertexCount) {
          pass.draw(this.staticVertexCount - this.buildPlateStart - this.buildPlateCount,
                    1, this.buildPlateStart + this.buildPlateCount, 0);
        }
      }

      // Draw build plate with temperature color
      if (this.buildPlateCount > 0) {
        const uniformData = new ArrayBuffer(80);
        const view = new Float32Array(uniformData);
        for (let i = 0; i < 16; i++) view[i] = viewProj[i];
        view[16] = plateR; view[17] = plateG; view[18] = plateB; view[19] = 0.5;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.setVertexBuffer(0, this.staticBuffer);
        pass.draw(this.buildPlateCount, 1, this.buildPlateStart, 0);
      }
    }

    // Draw dynamic parts (gantry + extruder) in bright orange
    if (this.dynamicBuffer && this.dynamicVertexCount > 0) {
      const uniformData = new ArrayBuffer(80);
      const view = new Float32Array(uniformData);
      for (let i = 0; i < 16; i++) view[i] = viewProj[i];
      view[16] = 1.0; view[17] = 0.6; view[18] = 0.1; view[19] = 0.9; // orange, 90% alpha
      this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.setVertexBuffer(0, this.dynamicBuffer);
      pass.draw(this.dynamicVertexCount);
    }
  }

  destroy(): void {
    this.staticBuffer?.destroy();
    this.dynamicBuffer?.destroy();
    this.uniformBuffer?.destroy();
  }
}
