# Base Sepolia Testnet Release Signoff (Manual Two-Step v1)

## Scope

- Release target: Base Sepolia testnet.
- Shipping path: manual two-step (`Step 1 submit`, `Step 2 finalize pending`).
- Relayer auto-finalize: deferred, not part of v1 production guarantees.

## Go/No-Go Checklist

- [x] Merge conflict state resolved in app branch (`frontend/app/page.tsx` no conflict markers).
- [x] SDK finalize semantics hardened with deterministic preflight errors:
  - `PROOF_INVALID`
  - `PENDING_NOT_READY`
  - `PENDING_EXPIRED`
  - `WALLET_UNAVAILABLE`
- [x] SDK two-step edge tests added and passing in local suite.
- [x] UI keeps manual Step 2 visible in v1 mode.
- [x] Env/docs aligned for manual-first ship with relayer explicitly deferred.
- [x] Live Base Sepolia scripted smoke test executed and attached to release notes.

## Verification Run (local)

Executed in `packages/sdk-ts`:

```bash
npm test
```

Result summary:

- Total tests: 23
- Passed: 23
- Failed: 0

## Release Notes Draft

### Included in this milestone

- Manual two-step private swap flow is the supported path.
- SDK now preflights finalize calls against pending readiness/deadline.
- SDK docs include explicit two-step integration flow and finalize error handling.
- Frontend enforces manual Step 2 visibility for this release scope.

### Deferred / Non-goals

- Relayer one-click auto-finalize reliability/security hardening.
- Claiming production readiness for unresolved on-chain swap gas-estimation issue.

## Live Smoke Test (Base Sepolia)

Executed from `frontend`:

```bash
yarn probe:two-step
```

Representative successful runs:

- Run 1
  - Step 1 swap tx: `0xccedc7f939e954877f35a109fee0b41888ca8499e7d9d3f0035720fafd5ffebd`
  - Step 1 gas used: `592770`
  - Step 2 finalize tx: `0xaea61118e4587a1f2a2d04f2fd179fddd218ce96c17d34e888cf607765cec28c`
  - Step 2 gas used: `367488`
- Run 2
  - Step 1 swap tx: `0x7f5d3cf0a12d39f82c6f1edc1399455969fd158bb1b94b1dfa710a386481c210`
  - Step 1 gas used: `592782`
  - Step 2 finalize tx: `0xcfaded8497ef3a4b1aa8d4fa6ab932b9b7e9aac7ae5f8bb87b53bf60b97e60a1`
  - Step 2 gas used: `367488`
- Run 3
  - Step 1 swap tx: `0x66eefef4066e52ffeda953b67697e73492ba245656e29324474d81a3d379dbc4`
  - Step 1 gas used: `592770`
  - Step 2 finalize tx: `0xc8688d516e546a88c3c64b17e9f2c5f81e9627f7ac7f2a8657e44f03e3a97628`
  - Step 2 gas used: `367488`

Observed range:

- Swap gas used: `592770` - `592782`
- Finalize gas used: `367488` (stable)
- Combined two-step gas: ~`960k`

## Final Decision

- Current status: **Conditional GO (testnet)**.
- All listed release conditions satisfied for manual two-step testnet scope.
