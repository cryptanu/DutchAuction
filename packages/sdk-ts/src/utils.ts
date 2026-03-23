import { AuctionClientError } from "./errors.js";
import type { Address, Hex } from "./types.js";

export const isHex = (value: string): value is Hex => /^0x[0-9a-fA-F]*$/.test(value);

export const isBytes32 = (value: string): value is Hex => isHex(value) && value.length === 66;

export const isAddress = (value: string): value is Address => isHex(value) && value.length === 42;

export const pad32 = (hexNoPrefix: string): string => hexNoPrefix.padStart(64, "0");

export const hexToBigInt = (value: Hex): bigint => BigInt(value);

export const toHexWord = (value: bigint): string => {
  if (value < 0n) {
    throw new AuctionClientError("INVALID_INPUT", "Negative values are not supported for word encoding.", { value });
  }

  const encoded = value.toString(16);
  if (encoded.length > 64) {
    throw new AuctionClientError("INVALID_INPUT", "Value exceeds 256-bit ABI word size.", { value: value.toString() });
  }
  return pad32(encoded);
};

export const encodeUintTuple3 = (a: bigint, b: bigint, c: bigint): Hex => {
  return `0x${toHexWord(a)}${toHexWord(b)}${toHexWord(c)}`;
};

export const toSignedWord = (value: bigint): string => {
  const max = (1n << 255n) - 1n;
  const min = -(1n << 255n);
  if (value > max || value < min) {
    throw new AuctionClientError("INVALID_INPUT", "Value exceeds int256 range.", { value: value.toString() });
  }

  if (value >= 0n) {
    return toHexWord(value);
  }

  const twosComplement = (1n << 256n) + value;
  return toHexWord(twosComplement);
};

export const strip0x = (value: Hex): string => value.slice(2);

export const assertUint128 = (value: bigint, label: string): void => {
  if (value < 0n || value > ((1n << 128n) - 1n)) {
    throw new AuctionClientError("INVALID_INPUT", `${label} must fit uint128.`, { value: value.toString() });
  }
};

export const nonEmptyCode = (code: Hex): boolean => code !== "0x";
