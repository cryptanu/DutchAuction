import { AuctionClientError } from "./errors.js";
import type { AuctionIntentProofs, InEProof } from "./types.js";
import { isHex } from "./utils.js";

const parseCtHash = (value: unknown, label: string): bigint => {
  if (value === undefined || value === null) {
    throw new AuctionClientError("INVALID_INPUT", `${label}.ctHash is required.`);
  }

  try {
    return typeof value === "bigint" ? value : BigInt(value as string | number);
  } catch {
    throw new AuctionClientError("INVALID_INPUT", `${label}.ctHash must be an integer value.`);
  }
};

const parseUint8 = (value: unknown, label: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
    throw new AuctionClientError("INVALID_INPUT", `${label} must be in uint8 range.`);
  }
  return parsed;
};

export const sanitizeProof = (proof: InEProof, label: string): InEProof => {
  const normalized: InEProof = {
    ctHash: parseCtHash((proof as { ctHash?: unknown }).ctHash, label),
    securityZone: parseUint8((proof as { securityZone?: unknown }).securityZone, `${label}.securityZone`),
    utype: parseUint8((proof as { utype?: unknown }).utype, `${label}.utype`),
    signature: (proof as { signature?: unknown }).signature as InEProof["signature"],
  };

  if (normalized.ctHash <= 0n) {
    throw new AuctionClientError("INVALID_INPUT", `${label}.ctHash must be > 0.`);
  }
  if (!isHex(normalized.signature)) {
    throw new AuctionClientError("INVALID_INPUT", `${label}.signature must be hex bytes.`);
  }

  // Return only the four required tuple fields for on-chain InE verification.
  return {
    ctHash: normalized.ctHash,
    securityZone: normalized.securityZone,
    utype: normalized.utype,
    signature: normalized.signature,
  };
};

export const sanitizeAuctionIntentProofs = (proofs: AuctionIntentProofs): AuctionIntentProofs => {
  return {
    desiredAuctionTokens: sanitizeProof(proofs.desiredAuctionTokens, "desiredAuctionTokens"),
  };
};
