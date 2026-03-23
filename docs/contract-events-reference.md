# Contract and Event Reference

## Core contracts

- `StealthDutchAuctionHook`
- `MockPoolManager` (integration harness)

## Read functions

- `poolAuctions(bytes32 poolId)`
- `getAuctionPlainState(uint256 auctionId)`

## Write functions

- `swap(...)` on pool manager
- `buyWithPaymentToken(bytes32 poolId, uint128 desired, uint128 maxPrice)`

## HookData tuple (plain)

`(uint128 desiredAuctionTokens, uint128 maxPricePerToken, uint128 minPaymentTokensFromSwap)`

## Events lifecycle

1. `PoolAuctionInitialized`
2. `AuctionIntentRegistered`
3. `AuctionPurchase`
4. `AuctionSoldOut` or `AuctionExpired`

## Integration expectation

- Track these events for activity feed, analytics, and settlement monitoring.
- Never infer private amounts from event payloads; use approved decrypt flow where needed.
