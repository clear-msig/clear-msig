/// <reference types="node" />

export declare function toBigIntLE(value: Uint8Array): bigint;
export declare function toBigIntBE(value: Uint8Array): bigint;
export declare function toBufferLE(value: bigint, width: number): Buffer;
export declare function toBufferBE(value: bigint, width: number): Buffer;
