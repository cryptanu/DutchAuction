export type AuctionClientErrorCode =
  | "INVALID_CONFIG"
  | "INVALID_INPUT"
  | "RPC_UNAVAILABLE"
  | "CONTRACT_UNREACHABLE"
  | "UNSUPPORTED_CHAIN"
  | "WALLET_UNAVAILABLE"
  | "COFHE_UNAVAILABLE"
  | "UNSUPPORTED_DECRYPT_FLOW"
  | "HOOKDATA_SDK_UNAVAILABLE"
  | "HOOKDATA_PROOF_UNAVAILABLE"
  | "PRICE_CAP_TOO_LOW"
  | "INSUFFICIENT_SWAP_OUTPUT"
  | "MIN_PAYMENT_TOO_HIGH"
  | "POOL_NOT_AVAILABLE"
  | "PROOF_INVALID"
  | "PENDING_NOT_READY"
  | "PENDING_EXPIRED";

export class AuctionClientError extends Error {
  readonly code: AuctionClientErrorCode;
  readonly details?: unknown;

  constructor(code: AuctionClientErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AuctionClientError";
    this.code = code;
    this.details = details;
  }
}

export const assert = (condition: boolean, code: AuctionClientErrorCode, message: string, details?: unknown): void => {
  if (!condition) {
    throw new AuctionClientError(code, message, details);
  }
};
