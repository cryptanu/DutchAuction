import { mockPoolManagerAbi, stealthDutchAuctionHookAbi } from "./abi.js";
import { AuctionClientError, assert } from "./errors.js";
import { runHealthcheck } from "./healthcheck.js";
import { buildHookData } from "./hookData.js";
import { sanitizeProof } from "./proofs.js";
import { quoteFromInputs } from "./quote.js";
import type {
  AuctionClientConfig,
  DecryptProofPayload,
  AuctionHealthcheck,
  AuctionIntentPlain,
  AuctionState,
  Hex,
  HookDataBuildInput,
  InEProof,
  QuoteSwapIntentInput,
  QuoteSwapIntentResult,
  SwapAndBuyParams,
  PoolKey,
  PendingPurchase,
} from "./types.js";
import { BASE_SEPOLIA_CHAIN_ID } from "./types.js";
import { assertUint128 } from "./utils.js";

type PoolAuctionTuple = readonly [Hex, Hex, Hex, bigint];
type AuctionStateTuple = readonly [Hex, boolean, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
type AuctionEncryptedTuple = readonly [
  Hex,
  Hex,
  Hex,
  Hex,
  Hex,
  Hex,
  Hex,
  Hex,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  boolean,
];
type PoolConfigTuple = readonly [PoolKey, bigint, bigint, boolean];
type PendingPurchaseTupleLegacy = readonly [
  bigint,
  Hex,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  Hex,
  Hex,
  bigint,
  boolean,
  boolean,
];
type PendingPurchaseTupleNamed = {
  auctionId: bigint;
  encAuctionTokens: Hex;
  maxPricePerToken: bigint;
  minPaymentTokensFromSwap: bigint;
  priceAtIntent: bigint;
  paymentOut: bigint;
  maxAffordableTokens: bigint;
  encFinalFill: Hex;
  encFinalPayment: Hex;
  finalizeDeadline: bigint;
  ready: boolean;
  direct: boolean;
};

const toPoolKey = (config: AuctionClientConfig): PoolKey => {
  return {
    currency0: config.addresses.token0Address,
    currency1: config.addresses.paymentTokenAddress,
    fee: config.pool.fee,
    tickSpacing: config.pool.tickSpacing,
    hooks: config.addresses.hookAddress,
  };
};

const ensureWriteClient = (config: AuctionClientConfig) => {
  if (!config.walletClient) {
    throw new AuctionClientError("WALLET_UNAVAILABLE", "walletClient is required for write operations.");
  }
  return config.walletClient;
};

const ensureBaseSepolia = (chainId: number): void => {
  if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new AuctionClientError("UNSUPPORTED_CHAIN", `Only Base Sepolia (${BASE_SEPOLIA_CHAIN_ID}) is supported in v1.`, {
      chainId,
    });
  }
};

const mapQuoteReasonToError = (quote: QuoteSwapIntentResult): AuctionClientError => {
  switch (quote.reason) {
    case "PRICE_CAP_TOO_LOW":
      return new AuctionClientError(
        "PRICE_CAP_TOO_LOW",
        "Max price per token is below current auction price.",
        quote,
      );
    case "MIN_PAYMENT_TOO_HIGH":
      return new AuctionClientError(
        "MIN_PAYMENT_TOO_HIGH",
        "Min payment tokens from swap exceeds expected swap output.",
        quote,
      );
    case "INSUFFICIENT_SWAP_OUTPUT":
      return new AuctionClientError(
        "INSUFFICIENT_SWAP_OUTPUT",
        "Swap input cannot fund desired auction tokens at current price.",
        quote,
      );
    default:
      return new AuctionClientError("POOL_NOT_AVAILABLE", "Pool quote data is unavailable.", quote);
  }
};

const validateIntent = (intent: AuctionIntentPlain): void => {
  assert(intent.desiredAuctionTokens > 0n, "INVALID_INPUT", "desiredAuctionTokens must be > 0");
  assert(intent.maxPricePerToken > 0n, "INVALID_INPUT", "maxPricePerToken must be > 0");
  assert(intent.minPaymentTokensFromSwap >= 0n, "INVALID_INPUT", "minPaymentTokensFromSwap must be >= 0");

  assertUint128(intent.desiredAuctionTokens, "desiredAuctionTokens");
  assertUint128(intent.maxPricePerToken, "maxPricePerToken");
  assertUint128(intent.minPaymentTokensFromSwap, "minPaymentTokensFromSwap");
};

const readAuctionState = async (
  config: AuctionClientConfig,
  auctionId: bigint,
): Promise<AuctionState> => {
  const plainTuple = (await config.publicClient.readContract({
    address: config.addresses.hookAddress,
    abi: stealthDutchAuctionHookAbi,
    functionName: "getAuctionPlainState",
    args: [auctionId],
  })) as AuctionStateTuple;

  const encryptedTuple = (await config.publicClient.readContract({
    address: config.addresses.hookAddress,
    abi: stealthDutchAuctionHookAbi,
    functionName: "auctions",
    args: [auctionId],
  })) as AuctionEncryptedTuple;

  return {
    auctionId,
    seller: plainTuple[0],
    isActive: plainTuple[1],
    startPrice: plainTuple[2],
    endPrice: plainTuple[3],
    currentPrice: plainTuple[4],
    sold: plainTuple[5],
    supply: plainTuple[6],
    startTime: plainTuple[7],
    duration: plainTuple[8],
    encrypted: {
      startPriceHandle: encryptedTuple[0],
      endPriceHandle: encryptedTuple[1],
      startTimeHandle: encryptedTuple[2],
      durationHandle: encryptedTuple[3],
      totalSupplyHandle: encryptedTuple[4],
      soldAmountHandle: encryptedTuple[5],
      isActiveHandle: encryptedTuple[6],
    },
  };
};

const resolveAuctionIdFromPool = async (config: AuctionClientConfig, poolId: Hex): Promise<bigint> => {
  const poolAuction = (await config.publicClient.readContract({
    address: config.addresses.hookAddress,
    abi: stealthDutchAuctionHookAbi,
    functionName: "poolAuctions",
    args: [poolId],
  })) as PoolAuctionTuple;

  const auctionId = poolAuction[3];
  if (auctionId === 0n) {
    throw new AuctionClientError("POOL_NOT_AVAILABLE", "Pool has no active auction.", { poolId });
  }

  return auctionId;
};

const quoteSwapIntent = async (
  config: AuctionClientConfig,
  input: QuoteSwapIntentInput,
): Promise<QuoteSwapIntentResult> => {
  ensureBaseSepolia(config.chainId);

  assert(input.swapInput > 0n, "INVALID_INPUT", "swapInput must be > 0");
  assert(input.desiredTokens > 0n, "INVALID_INPUT", "desiredTokens must be > 0");
  assert(input.maxPrice > 0n, "INVALID_INPUT", "maxPrice must be > 0");
  assert(input.minPayment >= 0n, "INVALID_INPUT", "minPayment must be >= 0");

  const auctionId = await resolveAuctionIdFromPool(config, input.poolId);
  const state = await readAuctionState(config, auctionId);

  const poolConfig = (await config.publicClient.readContract({
    address: config.addresses.poolManagerAddress,
    abi: mockPoolManagerAbi,
    functionName: "pools",
    args: [input.poolId],
  })) as PoolConfigTuple;

  return quoteFromInputs({
    swapInput: input.swapInput,
    desiredTokens: input.desiredTokens,
    maxPrice: input.maxPrice,
    minPayment: input.minPayment,
    currentPrice: state.currentPrice,
    token1PerToken0: poolConfig[1],
    denominator: poolConfig[2],
  });
};

const readPendingPurchase = async (
  config: AuctionClientConfig,
  poolId: Hex,
  buyer: Hex,
): Promise<PendingPurchase> => {
  const pendingRaw = await config.publicClient.readContract({
    address: config.addresses.hookAddress,
    abi: stealthDutchAuctionHookAbi,
    functionName: "getPendingPurchase",
    args: [buyer, poolId],
  });

  const pending = pendingRaw as PendingPurchaseTupleNamed | PendingPurchaseTupleLegacy;

  if (Array.isArray(pending)) {
    return {
      auctionId: pending[0],
      encAuctionTokensHandle: pending[1],
      maxPricePerToken: pending[2],
      minPaymentTokensFromSwap: pending[3],
      priceAtIntent: pending[4],
      paymentOut: pending[5],
      maxAffordableTokens: pending[6],
      encFinalFillHandle: pending[7],
      encFinalPaymentHandle: pending[8],
      finalizeDeadline: pending[9],
      ready: pending[10],
      direct: pending[11],
    };
  }

  const named = pending as PendingPurchaseTupleNamed;
  return {
    auctionId: named.auctionId,
    encAuctionTokensHandle: named.encAuctionTokens,
    maxPricePerToken: named.maxPricePerToken,
    minPaymentTokensFromSwap: named.minPaymentTokensFromSwap,
    priceAtIntent: named.priceAtIntent,
    paymentOut: named.paymentOut,
    maxAffordableTokens: named.maxAffordableTokens,
    encFinalFillHandle: named.encFinalFill,
    encFinalPaymentHandle: named.encFinalPayment,
    finalizeDeadline: named.finalizeDeadline,
    ready: named.ready,
    direct: named.direct,
  };
};

const resolveBuyerAddress = (config: AuctionClientConfig, buyer?: Hex): Hex => {
  const resolved =
    buyer ??
    (typeof config.walletClient?.account === "string" ? config.walletClient.account : config.walletClient?.account?.address);
  if (!resolved) {
    throw new AuctionClientError("WALLET_UNAVAILABLE", "buyer address is required when wallet account is unavailable.");
  }
  return resolved as Hex;
};

const validateFinalizeProof = (proof: DecryptProofPayload, label: "paymentProof" | "fillProof"): void => {
  assertUint128(proof.value, `${label}.value`);
  assert(
    /^0x[0-9a-fA-F]+$/.test(proof.signature) && proof.signature.length > 2,
    "PROOF_INVALID",
    `${label}.signature must be non-empty hex.`,
  );
};

const ensurePendingCanFinalize = async (config: AuctionClientConfig, input: { poolId: Hex; buyer: Hex }) => {
  const pending = await readPendingPurchase(config, input.poolId, input.buyer);
  if (pending.auctionId === 0n || !pending.ready) {
    throw new AuctionClientError("PENDING_NOT_READY", "Pending settlement is not ready to finalize.", {
      poolId: input.poolId,
      buyer: input.buyer,
      pending,
    });
  }
  if (pending.finalizeDeadline > 0n) {
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    if (nowSec > pending.finalizeDeadline) {
      throw new AuctionClientError("PENDING_EXPIRED", "Pending settlement finalize deadline has passed.", {
        poolId: input.poolId,
        buyer: input.buyer,
        finalizeDeadline: pending.finalizeDeadline,
        nowSec,
      });
    }
  }
  return pending;
};

export const createAuctionClient = (config: AuctionClientConfig) => {
  ensureBaseSepolia(config.chainId);

  const api = {
    async healthcheck(): Promise<AuctionHealthcheck> {
      return runHealthcheck(config);
    },
    auction: {
      async getState(input: { poolId?: Hex; auctionId?: bigint }): Promise<AuctionState> {
        const auctionId = input.auctionId ?? (input.poolId ? await resolveAuctionIdFromPool(config, input.poolId) : 0n);
        if (auctionId === 0n) {
          throw new AuctionClientError("INVALID_INPUT", "Provide poolId or auctionId to fetch state.");
        }
        return readAuctionState(config, auctionId);
      },
      async quoteSwapIntent(input: QuoteSwapIntentInput): Promise<QuoteSwapIntentResult> {
        return quoteSwapIntent(config, input);
      },
      async buildHookData(input: HookDataBuildInput): Promise<Hex> {
        return buildHookData(input, config.cofhe);
      },
      async swapAndBuy(params: SwapAndBuyParams): Promise<Hex> {
        validateIntent(params.intent);

        const quote = await quoteSwapIntent(config, {
          poolId: params.poolId,
          swapInput: params.swapInput,
          desiredTokens: params.intent.desiredAuctionTokens,
          maxPrice: params.intent.maxPricePerToken,
          minPayment: params.intent.minPaymentTokensFromSwap,
        });

        if (!quote.affordable) {
          throw mapQuoteReasonToError(quote);
        }

        const hookData = await buildHookData(
          {
            mode: params.mode,
            plainIntent: params.intent,
            proofs: params.proofs,
          },
          config.cofhe,
        );

        const walletClient = ensureWriteClient(config);
        const txHash = await walletClient.writeContract({
          address: config.addresses.poolManagerAddress,
          abi: mockPoolManagerAbi,
          functionName: "swap",
          chain: { id: config.chainId },
          args: [
            toPoolKey(config),
            {
              zeroForOne: true,
              amountSpecified: -params.swapInput,
              sqrtPriceLimitX96: 0n,
            },
            hookData,
          ],
        });

        return txHash;
      },
      async getPendingPurchase(input: { poolId: Hex; buyer?: Hex }): Promise<PendingPurchase> {
        const buyer = resolveBuyerAddress(config, input.buyer);
        return readPendingPurchase(config, input.poolId, buyer);
      },
      async finalizePendingPurchase(input: {
        poolId: Hex;
        paymentProof: DecryptProofPayload;
        fillProof: DecryptProofPayload;
      }): Promise<Hex> {
        validateFinalizeProof(input.paymentProof, "paymentProof");
        validateFinalizeProof(input.fillProof, "fillProof");
        const buyer = resolveBuyerAddress(config);
        await ensurePendingCanFinalize(config, { poolId: input.poolId, buyer });

        const walletClient = ensureWriteClient(config);
        const txHash = await walletClient.writeContract({
          address: config.addresses.hookAddress,
          abi: stealthDutchAuctionHookAbi,
          functionName: "finalizePendingPurchase",
          chain: { id: config.chainId },
          args: [
            input.poolId,
            input.paymentProof.value,
            input.paymentProof.signature,
            input.fillProof.value,
            input.fillProof.signature,
          ],
        });
        return txHash;
      },
      async finalizePendingPurchaseFor(input: {
        buyer: Hex;
        poolId: Hex;
        paymentProof: DecryptProofPayload;
        fillProof: DecryptProofPayload;
      }): Promise<Hex> {
        assert(input.buyer.length === 42, "INVALID_INPUT", "buyer must be a valid address.");
        validateFinalizeProof(input.paymentProof, "paymentProof");
        validateFinalizeProof(input.fillProof, "fillProof");
        await ensurePendingCanFinalize(config, { poolId: input.poolId, buyer: input.buyer });

        const walletClient = ensureWriteClient(config);
        const txHash = await walletClient.writeContract({
          address: config.addresses.hookAddress,
          abi: stealthDutchAuctionHookAbi,
          functionName: "finalizePendingPurchaseFor",
          chain: { id: config.chainId },
          args: [
            input.buyer,
            input.poolId,
            input.paymentProof.value,
            input.paymentProof.signature,
            input.fillProof.value,
            input.fillProof.signature,
          ],
        });
        return txHash;
      },
      async buyWithPaymentToken(input: {
        poolId: Hex;
        desiredAuctionTokens: bigint;
        maxPricePerToken: bigint;
      }): Promise<Hex> {
        input;
        throw new AuctionClientError(
          "UNSUPPORTED_DECRYPT_FLOW",
          "Plain direct-buy flow is disabled. Use buyWithPaymentTokenEncrypted(...) with encrypted proof inputs.",
        );
      },
      async buyWithPaymentTokenEncrypted(input: {
        poolId: Hex;
        desiredAuctionTokens: InEProof;
        maxPricePerToken: bigint;
      }): Promise<Hex> {
        const desiredAuctionTokens = sanitizeProof(input.desiredAuctionTokens, "desiredAuctionTokens");
        assertUint128(input.maxPricePerToken, "maxPricePerToken");

        const walletClient = ensureWriteClient(config);
        const txHash = await walletClient.writeContract({
          address: config.addresses.hookAddress,
          abi: stealthDutchAuctionHookAbi,
          functionName: "buyWithPaymentTokenEncrypted",
          chain: { id: config.chainId },
          args: [input.poolId, desiredAuctionTokens, input.maxPricePerToken],
        });

        return txHash;
      },
    },
    decrypt: {
      async forView<T = unknown>(input: { handle: Hex; securityZone?: number; utype?: number }): Promise<T> {
        if (!config.cofhe?.decryptForView) {
          throw new AuctionClientError(
            "COFHE_UNAVAILABLE",
            "decryptForView is unavailable. Inject @cofhe/sdk adapter in createAuctionClient config.",
          );
        }
        return (await config.cofhe.decryptForView(input)) as T;
      },
      async forTx<T = unknown>(input: { handle: Hex; securityZone?: number; utype?: number; policy?: string }): Promise<T> {
        if (!config.cofhe?.decryptForTx) {
          throw new AuctionClientError(
            "UNSUPPORTED_DECRYPT_FLOW",
            "decryptForTx is unavailable. Inject @cofhe/sdk adapter with transaction decrypt support.",
          );
        }
        return (await config.cofhe.decryptForTx(input)) as T;
      },
    },
  };

  return api;
};

export type AuctionClient = ReturnType<typeof createAuctionClient>;
