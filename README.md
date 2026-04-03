# Stealth Dutch Auction Monorepo (Foundry + cofhe)

Open-source Dutch Auction stack for DeFi launchpads.

This repo now ships a v1 SDK-first integration surface on **Base Sepolia** with explicit cofhe decrypt flows and a reference launchpad example.

## Deliverables

- `packages/contracts-core`
  - Contract ABIs + deployment metadata templates for integrators.
- `packages/sdk-ts`
  - Typed integration SDK (`createAuctionClient`) for healthcheck, quoting, hookData generation, tx writes, and decrypt flows.
- `examples-launchpad`
  - Minimal integration example for launchpad checkout flows.
- `frontend`
  - Scaffold-ETH reference UI with Auction Monitor, Activity, and Seller/Admin controls.

## Contract Architecture

Core contract: `src/StealthDutchAuctionHook.sol`

Flow:

1. User swaps token0 -> payment token in pool manager.
2. Hook validates auction intent in `beforeSwap`.
3. Hook settles encrypted payment + encrypted auction transfer in `afterSwap`.

Also supported:

- `buyWithPaymentTokenEncrypted(poolId, desiredAuctionTokens, maxPricePerToken)` for direct FHERC20 buy path.

## Privacy Hardening (Latest)

This version hardens settlement logic for privacy-first operation:

- Removed in-transaction decryptions of user encrypted intent values (`euint128`).
- Removed plaintext-bearing revert errors that leak comparison values.
- Replaced secret-dependent branching/reverts with encrypted branchless settlement using:
  - `FHE.lte/gte`
  - `FHE.min`
  - `FHE.and`
  - `FHE.select`
- Removed plaintext token transfer fallback; settlement uses encrypted transfer calls only.
- Disabled plaintext direct buy entrypoint (`buyWithPaymentToken`) with fail-closed behavior.

Current close/progress behavior:

- Auction close is time-based (`AuctionExpired`).
- Sold amount remains encrypted in-state; public sold/progress is not exposed as plaintext.

## SDK v1 API

`packages/sdk-ts/src/client.ts`

- `createAuctionClient(config)`
- `client.healthcheck()`
  - reports `rpc`, `cofheAvailable`, `decryptForView`, `decryptForTx`, `contractReachability`.
- `client.auction.getState({ poolId | auctionId })`
- `client.auction.quoteSwapIntent(...)`
  - returns `expectedPaymentOut`, `requiredPaymentAtCurrentPrice`, `affordable`, `reason`, `maxAffordableTokens`.
- `client.auction.buildHookData(...)`
  - supports encrypted modes `proofs` and `sdk` only.
- `client.auction.swapAndBuy(...)`
  - preflight guard + tx submission.
- `client.auction.getPendingPurchase(...)`
- `client.auction.finalizePendingPurchase(...)`
- `client.auction.finalizePendingPurchaseFor(...)`
- `client.auction.buyWithPaymentTokenEncrypted(...)`
- `client.decrypt.forView(...)`
- `client.decrypt.forTx(...)`

## Base Sepolia Scope

- Chain ID: `84532`
- RPC: `https://sepolia.base.org`
- Deployment script: `script/DeployBaseSepolia.s.sol`

## Quickstart

### Contracts

```bash
forge test
```

### SDK typecheck + tests

```bash
corepack yarn --cwd frontend tsc -p ../packages/sdk-ts/tsconfig.json --noEmit
corepack yarn --cwd frontend tsc -p ../packages/sdk-ts/tsconfig.json
node --test packages/sdk-ts/dist/test/**/*.test.js
```

### Frontend

```bash
cd frontend
yarn install
yarn dev
yarn probe:two-step
```

## Required Frontend Env

`frontend/.env.local`

```bash
NEXT_PUBLIC_HOOK_ADDRESS=
NEXT_PUBLIC_POOL_MANAGER_ADDRESS=
NEXT_PUBLIC_TOKEN0_ADDRESS=
NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS=
NEXT_PUBLIC_AUCTION_TOKEN_ADDRESS=
NEXT_PUBLIC_POOL_FEE=3000
NEXT_PUBLIC_POOL_TICK_SPACING=60
NEXT_PUBLIC_DEFAULT_SELLER_ADDRESS=
NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
NEXT_PUBLIC_RELAYER_ENABLED=false
NEXT_PUBLIC_RELAYER_ENDPOINT=/api/relayer/finalize-pending
```

### Relayer Env (deferred for v1)

Manual two-step finalize is the ship path for this milestone. Relayer one-click finalize is deferred.
If you test relayer mode locally, set these server-side vars in `frontend/.env.local`:

```bash
RELAYER_PRIVATE_KEY=
RELAYER_RPC_URL=https://sepolia.base.org
RELAYER_HOOK_ADDRESS=
```

## Docs

- Quickstart: `docs/quickstart-30min.md`
- Migration: `docs/migration-cofhejs-to-cofhe-sdk.md`
- Contract/Event reference: `docs/contract-events-reference.md`
- Troubleshooting: `docs/troubleshooting-base-sepolia.md`
- `transferFromEncrypted` fix-in-progress: `docs/transferFromEncrypted-fix-in-progress.md`
- Integrator use-cases: `docs/integrator-use-cases.md`
- Support model: `docs/support-model.md`

## CI and Release Gates

- Foundry tests: `forge test`
- SDK typecheck + unit tests
- Legacy flow guard: `scripts/check-no-legacy-cofhe.sh`

## Notes

- No logic was copied from the external repository reference; implementation was built from architecture requirements.
- v1 is SDK-first and self-serve. Plugin packaging is deferred to v2.
- Legacy `cofhejs` pathways are fail-closed; migration target is `@cofhe/sdk`.
- Fix in progress (as of 2026-03-23): `transferFromEncrypted` now avoids hard failure when decrypt result is not ready
  by using `getDecryptResultSafe(...)`, but settlement still computes with decrypted amount when available (allowance
  update + `_transfer`), which is a privacy leak surface. See `docs/transferFromEncrypted-fix-in-progress.md`.
- Latest live probe (Base Sepolia, 2026-04-03): manual two-step settlement is executing below gas cap with stable
  measured usage:
  - Step 1 swap + register intent: ~`592,770` to `592,782` gas.
  - Step 2 finalize pending purchase: ~`367,488` gas.
  - Combined path: ~`960k` gas, well below Base Sepolia per-tx cap (`25,000,000`).
- Added deterministic signed probe command: `cd frontend && yarn probe:two-step`.
  The probe now includes:
  - pending-read retry window after step 1 (handles RPC read-after-write lag),
  - decrypt-for-tx retry/backoff for transient threshold-service responses (`403/404/428`),
  - pending-clear verification after step 2.
- v1 release scope (testnet): manual two-step flow is primary (`Step 1 submit`, `Step 2 finalize pending`); relayer
  one-click flow is out-of-scope for production guarantees in this release.
