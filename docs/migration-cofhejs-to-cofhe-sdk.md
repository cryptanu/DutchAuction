# Migration: `cofhejs` -> `@cofhe/sdk`

Legacy decryption flow is deprecated and EOL is April 13, 2026.

References:

- SDK docs: https://cofhe-docs.fhenix.zone/client-sdk/introduction/overview
- Migration guide: https://cofhe-docs.fhenix.zone/client-sdk/introduction/migrating-from-cofhejs

## Required migration changes

1. Remove any legacy `cofhejs` usage from app code.
2. Inject explicit methods from `@cofhe/sdk` into SDK client config.
3. Split decryption calls by intent:
   - `decrypt.forView` (local UI read)
   - `decrypt.forTx` (on-chain reveal)

## Old vs new mental model

- Old: implicit/global decrypt path
- New: explicit decrypt destination and verification semantics

## Adapter template

```ts
const cofheAdapter = {
  buildAuctionIntentHookData: intent => cofheSdk.buildAuctionIntentHookData(intent),
  decryptForView: args => cofheSdk.decrypt.forView(args),
  decryptForTx: args => cofheSdk.decrypt.forTx(args),
};
```

## Runtime behavior in v1 SDK

- Legacy wrapper `wrapDeprecatedCofhejs(...)` intentionally fails closed with `UNSUPPORTED_DECRYPT_FLOW`.
- This prevents silent regressions and mixed flow semantics.
