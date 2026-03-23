import { AuctionClientError } from "./errors.js";
import { sanitizeAuctionIntentProofs } from "./proofs.js";
import type { CofheAdapter, HookDataBuildInput, Hex } from "./types.js";
import { assertUint128, isHex, toHexWord } from "./utils.js";

const buildSdkHookData = async (input: HookDataBuildInput, cofhe?: CofheAdapter): Promise<Hex> => {
  if (!cofhe?.buildAuctionIntentHookData) {
    throw new AuctionClientError(
      "HOOKDATA_SDK_UNAVAILABLE",
      "SDK mode requires cofhe.buildAuctionIntentHookData injected in createAuctionClient config.",
    );
  }

  const payload = await cofhe.buildAuctionIntentHookData({
    desiredAuctionTokens: input.plainIntent.desiredAuctionTokens.toString(),
    maxPricePerToken: input.plainIntent.maxPricePerToken.toString(),
    minPaymentTokensFromSwap: input.plainIntent.minPaymentTokensFromSwap.toString(),
  });

  if (!isHex(payload)) {
    throw new AuctionClientError("HOOKDATA_SDK_UNAVAILABLE", "cofhe SDK builder must return a hex payload.");
  }

  return payload;
};

const buildProofHookData = async (input: HookDataBuildInput): Promise<Hex> => {
  if (!input.proofs) {
    throw new AuctionClientError("INVALID_INPUT", "Proof mode requires desiredAuctionTokens encrypted proof.");
  }

  assertUint128(input.plainIntent.maxPricePerToken, "maxPricePerToken");
  assertUint128(input.plainIntent.minPaymentTokensFromSwap, "minPaymentTokensFromSwap");
  const sanitizedProofs = sanitizeAuctionIntentProofs(input.proofs);

  const signature = sanitizedProofs.desiredAuctionTokens.signature.slice(2);
  if (signature.length % 2 !== 0) {
    throw new AuctionClientError("INVALID_INPUT", "desiredAuctionTokens.signature must be even-length hex bytes.");
  }

  const signatureLength = BigInt(signature.length / 2);
  const signatureWordLen = signature.length === 0 ? 0 : Math.ceil(signature.length / 64) * 64;
  const signaturePadded = signature.padEnd(signatureWordLen, "0");

  const desiredTupleHeadSize = 4n * 32n;
  const outerTupleHeadSize = 3n * 32n;

  const payload =
    "0x" +
    toHexWord(32n) +
    toHexWord(outerTupleHeadSize) +
    toHexWord(input.plainIntent.maxPricePerToken) +
    toHexWord(input.plainIntent.minPaymentTokensFromSwap) +
    toHexWord(sanitizedProofs.desiredAuctionTokens.ctHash) +
    toHexWord(BigInt(sanitizedProofs.desiredAuctionTokens.securityZone)) +
    toHexWord(BigInt(sanitizedProofs.desiredAuctionTokens.utype)) +
    toHexWord(desiredTupleHeadSize) +
    toHexWord(signatureLength) +
    signaturePadded;

  return payload as Hex;
};

export const buildHookData = async (input: HookDataBuildInput, cofhe?: CofheAdapter): Promise<Hex> => {
  switch (input.mode) {
    case "proofs":
      return buildProofHookData(input);
    case "sdk":
      return buildSdkHookData(input, cofhe);
    default:
      throw new AuctionClientError("INVALID_INPUT", `Unsupported hookData mode: ${String(input.mode)}`);
  }
};
