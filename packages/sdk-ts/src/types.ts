export type Hex = `0x${string}`;
export type Address = Hex;

export const BASE_SEPOLIA_CHAIN_ID = 84_532;

export type AuctionAddresses = {
  hookAddress: Address;
  poolManagerAddress: Address;
  token0Address: Address;
  paymentTokenAddress: Address;
  auctionTokenAddress: Address;
};

export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

export type AuctionIntentPlain = {
  desiredAuctionTokens: bigint;
  maxPricePerToken: bigint;
  minPaymentTokensFromSwap: bigint;
};

export type InEProof = {
  ctHash: bigint;
  securityZone: number;
  utype: number;
  signature: Hex;
};

export type AuctionIntentProofs = {
  desiredAuctionTokens: InEProof;
};

export type HookDataMode = "proofs" | "sdk";

export type HookDataBuildInput = {
  mode: HookDataMode;
  plainIntent: AuctionIntentPlain;
  proofs?: AuctionIntentProofs;
};

export type CofheDecryptForViewInput = {
  handle: Hex;
  securityZone?: number;
  utype?: number;
};

export type CofheDecryptForTxInput = {
  handle: Hex;
  securityZone?: number;
  utype?: number;
  policy?: string;
};

export interface CofheAdapter {
  buildAuctionIntentHookData?: (intent: {
    desiredAuctionTokens: string;
    maxPricePerToken: string;
    minPaymentTokensFromSwap: string;
  }) => Promise<Hex> | Hex;
  decryptForView?: (input: CofheDecryptForViewInput) => Promise<unknown>;
  decryptForTx?: (input: CofheDecryptForTxInput) => Promise<unknown>;
}

export type ContractReadRequest = {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
};

export type ContractWriteRequest = {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  chain?: {
    id: number;
  };
};

export interface PublicClientLike {
  chain?: {
    id: number;
  };
  getBlockNumber: () => Promise<bigint>;
  getCode: (input: { address: Address }) => Promise<Hex>;
  readContract: (input: ContractReadRequest) => Promise<unknown>;
}

export interface WalletClientLike {
  chain?: {
    id: number;
  };
  account?: {
    address: Address;
  } | Address;
  writeContract: (input: ContractWriteRequest) => Promise<Hex>;
}

export type AuctionClientConfig = {
  chainId: number;
  publicClient: PublicClientLike;
  walletClient?: WalletClientLike;
  addresses: AuctionAddresses;
  pool: {
    fee: number;
    tickSpacing: number;
  };
  cofhe?: CofheAdapter;
};

export type AuctionHealthcheck = {
  chainId: number;
  rpc: boolean;
  cofheAvailable: boolean;
  decryptForView: boolean;
  decryptForTx: boolean;
  contractReachability: {
    hook: boolean;
    poolManager: boolean;
    token0: boolean;
    paymentToken: boolean;
    auctionToken: boolean;
  };
};

export type AuctionState = {
  auctionId: bigint;
  seller: Address;
  isActive: boolean;
  startPrice: bigint;
  endPrice: bigint;
  currentPrice: bigint;
  sold: bigint;
  supply: bigint;
  startTime: bigint;
  duration: bigint;
  encrypted: {
    startPriceHandle: Hex;
    endPriceHandle: Hex;
    startTimeHandle: Hex;
    durationHandle: Hex;
    totalSupplyHandle: Hex;
    soldAmountHandle: Hex;
    isActiveHandle: Hex;
  };
};

export type QuoteSwapIntentInput = {
  poolId: Hex;
  swapInput: bigint;
  desiredTokens: bigint;
  maxPrice: bigint;
  minPayment: bigint;
};

export type QuoteReason =
  | "OK"
  | "PRICE_CAP_TOO_LOW"
  | "INSUFFICIENT_SWAP_OUTPUT"
  | "MIN_PAYMENT_TOO_HIGH"
  | "POOL_NOT_AVAILABLE";

export type QuoteSwapIntentResult = {
  expectedPaymentOut: bigint;
  requiredPaymentAtCurrentPrice: bigint;
  affordable: boolean;
  reason: QuoteReason;
  currentPrice: bigint;
  maxAffordableTokens: bigint;
};

export type SwapAndBuyParams = {
  poolId: Hex;
  swapInput: bigint;
  intent: AuctionIntentPlain;
  mode: HookDataMode;
  proofs?: HookDataBuildInput["proofs"];
};
