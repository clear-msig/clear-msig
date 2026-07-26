"use strict";

const BufferImpl = globalThis.Buffer || require("buffer").Buffer;

function toBigIntLE(value) {
  const bytes = BufferImpl.from(value);
  bytes.reverse();
  return bytesToBigInt(bytes);
}

function toBigIntBE(value) {
  return bytesToBigInt(BufferImpl.from(value));
}

function toBufferLE(value, width) {
  const bytes = toBufferBE(value, width);
  bytes.reverse();
  return bytes;
}

function toBufferBE(value, width) {
  assertUnsignedBigInt(value);
  assertWidth(width);

  if (width === 0) {
    if (value !== 0n) throw new RangeError("BigInt does not fit in a zero-width buffer");
    return BufferImpl.alloc(0);
  }

  const hex = value.toString(16);
  if (hex.length > width * 2) {
    throw new RangeError(`BigInt does not fit in ${width} bytes`);
  }
  return BufferImpl.from(hex.padStart(width * 2, "0"), "hex");
}

function bytesToBigInt(bytes) {
  const hex = bytes.toString("hex");
  return hex.length === 0 ? 0n : BigInt(`0x${hex}`);
}

function assertUnsignedBigInt(value) {
  if (typeof value !== "bigint" || value < 0n) {
    throw new TypeError("Expected a non-negative bigint");
  }
}

function assertWidth(width) {
  if (!Number.isSafeInteger(width) || width < 0) {
    throw new RangeError("Buffer width must be a non-negative safe integer");
  }
}

module.exports = { toBigIntLE, toBigIntBE, toBufferLE, toBufferBE };
