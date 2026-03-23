import type { QuoteReason, QuoteSwapIntentResult } from "./types.js";

export const quoteFromInputs = (input: {
  swapInput: bigint;
  desiredTokens: bigint;
  maxPrice: bigint;
  minPayment: bigint;
  currentPrice: bigint;
  token1PerToken0: bigint;
  denominator: bigint;
}): QuoteSwapIntentResult => {
  if (input.denominator <= 0n || input.token1PerToken0 <= 0n) {
    return {
      expectedPaymentOut: 0n,
      requiredPaymentAtCurrentPrice: 0n,
      affordable: false,
      reason: "POOL_NOT_AVAILABLE",
      currentPrice: input.currentPrice,
      maxAffordableTokens: 0n,
    };
  }

  const expectedPaymentOut = (input.swapInput * input.token1PerToken0) / input.denominator;
  const requiredPaymentAtCurrentPrice = input.desiredTokens * input.currentPrice;
  const maxAffordableTokens = input.currentPrice > 0n ? expectedPaymentOut / input.currentPrice : 0n;

  let reason: QuoteReason = "OK";
  let affordable = true;

  if (input.maxPrice < input.currentPrice) {
    affordable = false;
    reason = "PRICE_CAP_TOO_LOW";
  } else if (expectedPaymentOut < input.minPayment) {
    affordable = false;
    reason = "MIN_PAYMENT_TOO_HIGH";
  } else if (expectedPaymentOut < requiredPaymentAtCurrentPrice) {
    affordable = false;
    reason = "INSUFFICIENT_SWAP_OUTPUT";
  }

  return {
    expectedPaymentOut,
    requiredPaymentAtCurrentPrice,
    affordable,
    reason,
    currentPrice: input.currentPrice,
    maxAffordableTokens,
  };
};
