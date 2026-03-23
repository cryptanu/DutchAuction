# @najnomics/dutch-auction-contracts-core

Contract-side deliverable for integrators.

## Contents

- `abi/StealthDutchAuctionHook.json`
- `abi/MockPoolManager.json`
- `metadata/base-sepolia.example.json`

## Notes

- Chain scope for v1: Base Sepolia (`84532`).
- Source of truth contract implementation remains in root `src/` and Foundry tests in `test/`.
- Use these ABI artifacts from external SDK/app integrations to avoid copying contract internals.
