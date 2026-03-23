export const stealthDutchAuctionHookAbi = [
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "initializeAuctionPool",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      { name: "auctionToken", type: "address" },
      { name: "startPrice", type: "uint128" },
      { name: "endPrice", type: "uint128" },
      { name: "duration", type: "uint64" },
      { name: "supply", type: "uint128" },
      { name: "seller", type: "address" },
    ],
    outputs: [{ name: "auctionId", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "poolAuctions",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "poolId", type: "bytes32" },
      { name: "auctionToken", type: "address" },
      { name: "paymentToken", type: "address" },
      { name: "activeAuctionId", type: "uint256" },
    ],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "getAuctionPlainState",
    inputs: [{ name: "auctionId", type: "uint256" }],
    outputs: [
      { name: "seller", type: "address" },
      { name: "isActive", type: "bool" },
      { name: "startPrice", type: "uint128" },
      { name: "endPrice", type: "uint128" },
      { name: "current", type: "uint128" },
      { name: "sold", type: "uint128" },
      { name: "supply", type: "uint128" },
      { name: "startTime", type: "uint64" },
      { name: "duration", type: "uint64" },
    ],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "currentPrice",
    inputs: [{ name: "auctionId", type: "uint256" }],
    outputs: [{ name: "price", type: "uint128" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "nextAuctionId",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "buyWithPaymentTokenEncrypted",
    inputs: [
      { name: "poolId", type: "bytes32" },
      {
        name: "desiredAuctionTokens",
        type: "tuple",
        components: [
          { name: "ctHash", type: "uint256" },
          { name: "securityZone", type: "uint8" },
          { name: "utype", type: "uint8" },
          { name: "signature", type: "bytes" },
        ],
      },
      {
        name: "maxPricePerToken",
        type: "tuple",
        components: [
          { name: "ctHash", type: "uint256" },
          { name: "securityZone", type: "uint8" },
          { name: "utype", type: "uint8" },
          { name: "signature", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "paymentTokensSpent", type: "uint128" }],
  },
  {
    type: "event",
    anonymous: false,
    name: "PoolAuctionInitialized",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "auctionId", type: "uint256", indexed: true },
      { name: "seller", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "AuctionIntentRegistered",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "auctionId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "AuctionPurchase",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "auctionId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "timestamp", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "AuctionSoldOut",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "auctionId", type: "uint256", indexed: true },
    ],
  },
  {
    type: "event",
    anonymous: false,
    name: "AuctionExpired",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "auctionId", type: "uint256", indexed: true },
    ],
  },
] as const;

export const mockPoolManagerAbi = [
  {
    type: "function",
    stateMutability: "view",
    name: "pools",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      { name: "token1PerToken0", type: "uint256" },
      { name: "denominator", type: "uint256" },
      { name: "exists", type: "bool" },
    ],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "swap",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "zeroForOne", type: "bool" },
          { name: "amountSpecified", type: "int256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [{ name: "delta", type: "int256" }],
  },
] as const;

export const mockFherc20Abi = [
  {
    type: "function",
    stateMutability: "view",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "mint",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export type HookDataMode = "proofs" | "sdk";
