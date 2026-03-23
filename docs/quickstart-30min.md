# Integrate in 30 Minutes (Launchpad)

## 1) Install artifacts + SDK

- Contracts ABI: `packages/contracts-core/abi`
- SDK: `packages/sdk-ts`

## 2) Configure Base Sepolia

- Chain ID: `84532`
- RPC: `https://sepolia.base.org`
- Provide: hook, pool manager, token0, payment token, auction token addresses.

## 3) Inject `@cofhe/sdk` adapter

Your adapter must provide:

- `buildAuctionIntentHookData(intent)`
- `decryptForView(input)`
- `decryptForTx(input)`

Frontend helper (Scaffold app):

```ts
import { injectCofheHookDataBuilder } from "../frontend/lib/auction/cofheAdapter";

injectCofheHookDataBuilder(intent => cofheSdk.buildAuctionIntentHookData(intent));
```

## 4) Create client

```ts
const client = createAuctionClient({
  chainId: 84532,
  publicClient,
  walletClient,
  addresses,
  pool: { fee: 3000, tickSpacing: 60 },
  cofhe,
});
```

## 5) Run healthcheck

- `await client.healthcheck()`
- Require: `rpc === true`, all contract reachability flags true.

## 6) Quote and submit

- `quoteSwapIntent` first.
- If `affordable === false`, show reason and do not submit.
- If affordable, call `swapAndBuy`.

## 7) Decrypt flows

- UI-only reveal: `decrypt.forView`
- On-chain reveal with verifiable signature: `decrypt.forTx`
