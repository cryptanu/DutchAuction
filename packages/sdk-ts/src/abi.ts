export const stealthDutchAuctionHookAbi = [
  {
    type: "function",
    stateMutability: "view",
    name: "poolAuctions",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "poolId", type: "bytes32" },
      { name: "auctionToken", type: "address" },
      { name: "paymentToken", type: "address" },
      { name: "activeAuctionId", type: "uint256" }
    ]
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
      { name: "duration", type: "uint64" }
    ]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "auctions",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "startPrice", type: "bytes32" },
      { name: "endPrice", type: "bytes32" },
      { name: "startTime", type: "bytes32" },
      { name: "duration", type: "bytes32" },
      { name: "totalSupply", type: "bytes32" },
      { name: "soldAmount", type: "bytes32" },
      { name: "isActive", type: "bytes32" },
      { name: "seller", type: "address" },
      { name: "startPricePlain", type: "uint128" },
      { name: "endPricePlain", type: "uint128" },
      { name: "startTimePlain", type: "uint64" },
      { name: "durationPlain", type: "uint64" },
      { name: "totalSupplyPlain", type: "uint128" },
      { name: "soldAmountPlain", type: "uint128" },
      { name: "isActivePlain", type: "bool" }
    ]
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
          { name: "signature", type: "bytes" }
        ]
      },
      {
        name: "maxPricePerToken",
        type: "tuple",
        components: [
          { name: "ctHash", type: "uint256" },
          { name: "securityZone", type: "uint8" },
          { name: "utype", type: "uint8" },
          { name: "signature", type: "bytes" }
        ]
      }
    ],
    outputs: [{ name: "paymentTokensSpent", type: "uint128" }]
  }
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
          { name: "hooks", type: "address" }
        ]
      },
      { name: "token1PerToken0", type: "uint256" },
      { name: "denominator", type: "uint256" },
      { name: "exists", type: "bool" }
    ]
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
          { name: "hooks", type: "address" }
        ]
      },
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "zeroForOne", type: "bool" },
          { name: "amountSpecified", type: "int256" },
          { name: "sqrtPriceLimitX96", type: "uint160" }
        ]
      },
      { name: "hookData", type: "bytes" }
    ],
    outputs: [{ name: "delta", type: "int256" }]
  }
] as const;
