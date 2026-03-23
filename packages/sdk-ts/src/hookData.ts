import { AuctionClientError } from "./errors.js";
import type { CofheAdapter, HookDataBuildInput, Hex } from "./types.js";
import { isHex } from "./utils.js";

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

const buildProofHookData = async (input: HookDataBuildInput, cofhe?: CofheAdapter): Promise<Hex> => {
  if (!input.proofs) {
    throw new AuctionClientError("INVALID_INPUT", "Proof mode requires proof payloads for all intent fields.");
  }

  if (!cofhe?.buildAuctionIntentProofHookData) {
    throw new AuctionClientError(
      "HOOKDATA_PROOF_UNAVAILABLE",
      "Proof mode requires cofhe.buildAuctionIntentProofHookData injected in createAuctionClient config.",
    );
  }

  const payload = await cofhe.buildAuctionIntentProofHookData(input.proofs);
  if (!isHex(payload)) {
    throw new AuctionClientError("HOOKDATA_PROOF_UNAVAILABLE", "cofhe proof builder must return a hex payload.");
  }

  return payload;
};

export const buildHookData = async (input: HookDataBuildInput, cofhe?: CofheAdapter): Promise<Hex> => {
  switch (input.mode) {
    case "proofs":
      return buildProofHookData(input, cofhe);
    case "sdk":
      return buildSdkHookData(input, cofhe);
    default:
      throw new AuctionClientError("INVALID_INPUT", `Unsupported hookData mode: ${String(input.mode)}`);
  }
};
