/**
 * @file BinaryReader.ts
 * @brief Sequential binary reader for little-endian TTHR format.
 */

export class BinaryReader {
  private offset = 0;
  private view: DataView;
  private bytes: Uint8Array;

  constructor(buffer: ArrayBuffer | Uint8Array) {
    if (buffer instanceof Uint8Array) {
      // Copy to ensure we have a dedicated ArrayBuffer with correct byteOffset
      const copy = new Uint8Array(buffer.byteLength);
      copy.set(buffer);
      this.bytes = copy;
      this.view = new DataView(copy.buffer);
    } else {
      this.bytes = new Uint8Array(buffer);
      this.view = new DataView(buffer);
    }
  }

  get position(): number {
    return this.offset;
  }

  get length(): number {
    return this.bytes.length;
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  seek(pos: number): void {
    if (pos < 0 || pos > this.bytes.length) {
      throw new RangeError(`Seek position ${pos} out of range [0, ${this.bytes.length}]`);
    }
    this.offset = pos;
  }

  readUint8(): number {
    if (this.offset + 1 > this.bytes.length) throw new RangeError('Read past end');
    return this.view.getUint8(this.offset++);
  }

  readUint16(): number {
    if (this.offset + 2 > this.bytes.length) throw new RangeError('Read past end');
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  readUint32(): number {
    if (this.offset + 4 > this.bytes.length) throw new RangeError('Read past end');
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readInt32(): number {
    if (this.offset + 4 > this.bytes.length) throw new RangeError('Read past end');
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readFloat32(): number {
    if (this.offset + 4 > this.bytes.length) throw new RangeError('Read past end');
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readFloat64(): number {
    if (this.offset + 8 > this.bytes.length) throw new RangeError('Read past end');
    const v = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return v;
  }

  readBytes(count: number): Uint8Array {
    if (this.offset + count > this.bytes.length) throw new RangeError('Read past end');
    const slice = this.bytes.subarray(this.offset, this.offset + count);
    this.offset += count;
    return slice;
  }

  readString(length: number): string {
    const bytes = this.readBytes(length);
    return new TextDecoder().decode(bytes);
  }

  readFloat32Array(count: number): Float32Array {
    if (this.offset + count * 4 > this.bytes.length) throw new RangeError('Read past end');
    const byteOffset = this.bytes.byteOffset + this.offset;
    let result: Float32Array;
    if (byteOffset % 4 === 0) {
      result = new Float32Array(this.bytes.buffer, byteOffset, count);
    } else {
      // Unaligned: copy to a new buffer
      result = new Float32Array(count);
      const tmp = new Uint8Array(this.bytes.buffer, byteOffset, count * 4);
      new Uint8Array(result.buffer).set(tmp);
    }
    this.offset += count * 4;
    return result;
  }

  readFloat64Array(count: number): Float64Array {
    if (this.offset + count * 8 > this.bytes.length) throw new RangeError('Read past end');
    const byteOffset = this.bytes.byteOffset + this.offset;
    let result: Float64Array;
    if (byteOffset % 8 === 0) {
      result = new Float64Array(this.bytes.buffer, byteOffset, count);
    } else {
      result = new Float64Array(count);
      const tmp = new Uint8Array(this.bytes.buffer, byteOffset, count * 8);
      new Uint8Array(result.buffer).set(tmp);
    }
    this.offset += count * 8;
    return result;
  }
}
