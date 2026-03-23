import { AuctionClientError } from "./errors.js";
import type { CofheAdapter, Hex } from "./types.js";

type UnknownRecord = Record<string, unknown>;

export type LegacyCofhejsLike = {
  encrypt?: unknown;
  decrypt?: unknown;
  decryptValue?: unknown;
  createPermit?: unknown;
};

export const wrapDeprecatedCofhejs = (_legacy: LegacyCofhejsLike): CofheAdapter => {
  const reject = () => {
    throw new AuctionClientError(
      "UNSUPPORTED_DECRYPT_FLOW",
      "Legacy cofhejs flows are deprecated. Migrate to @cofhe/sdk and inject decryptForView/decryptForTx.",
    );
  };

  return {
    buildAuctionIntentHookData: async () => reject(),
    decryptForView: async () => reject(),
    decryptForTx: async () => reject(),
  };
};

export const fromCofheSdk = (sdk: UnknownRecord): CofheAdapter => {
  const buildAuctionIntentHookData =
    typeof sdk.buildAuctionIntentHookData === "function"
      ? (sdk.buildAuctionIntentHookData as CofheAdapter["buildAuctionIntentHookData"])
      : typeof (sdk.cofhe as UnknownRecord | undefined)?.buildAuctionIntentHookData === "function"
        ? ((sdk.cofhe as UnknownRecord).buildAuctionIntentHookData as CofheAdapter["buildAuctionIntentHookData"])
        : undefined;

  const decryptForView =
    typeof sdk.decryptForView === "function"
      ? (sdk.decryptForView as CofheAdapter["decryptForView"])
      : typeof (sdk.decrypt as UnknownRecord | undefined)?.forView === "function"
        ? ((sdk.decrypt as UnknownRecord).forView as CofheAdapter["decryptForView"])
        : undefined;

  const decryptForTx =
    typeof sdk.decryptForTx === "function"
      ? (sdk.decryptForTx as CofheAdapter["decryptForTx"])
      : typeof (sdk.decrypt as UnknownRecord | undefined)?.forTx === "function"
        ? ((sdk.decrypt as UnknownRecord).forTx as CofheAdapter["decryptForTx"])
        : undefined;

  return {
    buildAuctionIntentHookData,
    decryptForView,
    decryptForTx,
  };
};

export const ensureHexHandle = (value: string): Hex => {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new AuctionClientError("INVALID_INPUT", "Handle must be hex.", { value });
  }
  return value as Hex;
};
