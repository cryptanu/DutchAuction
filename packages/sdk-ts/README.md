# @najnomics/dutch-auction-sdk

TypeScript SDK for integrating Stealth Dutch Auction hook flows in launchpad products.

## What it provides

- `createAuctionClient(config)`
- Healthcheck for RPC/contract/cofhe capabilities
- Auction state reads and quote preflight checks
- HookData builders (`proofs`, `sdk`) only
- Swap + buy orchestration with deterministic error codes
- Direct encrypted `buyWithPaymentTokenEncrypted` path
- Explicit decrypt paths:
  - `decrypt.forView(...)`
  - `decrypt.forTx(...)`

## Migration stance

Legacy `cofhejs` paths are intentionally unsupported in v1 and fail closed.
Use `@cofhe/sdk` by injecting a cofhe adapter into client config.

## Quick sample

```ts
import { createAuctionClient } from "@najnomics/dutch-auction-sdk";

const client = createAuctionClient({
  chainId: 84532,
  publicClient,
  walletClient,
  addresses,
  pool: { fee: 3000, tickSpacing: 60 },
  cofhe: {
    buildAuctionIntentHookData: async intent => cofheSdk.buildAuctionIntentHookData(intent),
    decryptForView: args => cofheSdk.decrypt.forView(args),
    decryptForTx: args => cofheSdk.decrypt.forTx(args),
  },
});

const health = await client.healthcheck();
```
