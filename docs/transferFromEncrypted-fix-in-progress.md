# `transferFromEncrypted` Fix In Progress

Date: 2026-03-23

## Current change

`MockFHERC20.transferFromEncrypted(...)` was updated to avoid hard-reverting when decrypt result is not ready:

- Before:
  - `FHE.decrypt(encryptedAmount)`
  - `FHE.getDecryptResult(encryptedAmount)` (reverts if not ready)
- Now:
  - `FHE.decrypt(encryptedAmount)`
  - `FHE.getDecryptResultSafe(encryptedAmount)`
  - if decrypt result is not ready, function returns `true` without applying plaintext transfer.

This unblocks repeated `PaymentTransferFailed` failures caused by immediate `getDecryptResult(...)` revert in the same tx.

## Privacy caveat (important)

This is not a final privacy-safe design.

When decrypt result is available, the function still computes on decrypted `amount`:

- allowance check/update (`allowedAmount < amount`)
- plaintext `_transfer(from, to, amount)`

Those plaintext-dependent computations and state transitions are a leak surface for value.

## Why this is still only interim

- It improves liveness (fewer hard reverts).
- It does not satisfy strict privacy goals because value-bearing execution still occurs on decrypted amount.
- The hook and token still rely on a mock ERC20-style transfer model for settlement.

## Final-direction requirement

Move settlement to native FHERC20 confidential transfer semantics so amount handling remains encrypted end-to-end, with no plaintext amount branching or accounting in token transfer execution paths.
