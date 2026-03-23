# Troubleshooting (Base Sepolia)

## `eth_getLogs is limited to a 10,000 range`

- Query logs in block chunks (`<= 9,999` range).

## Gas estimation says exceeds per-tx limit

Usually indicates an invalid path during simulation, not actual required gas.

Common causes:

- `maxPricePerToken < currentPrice`
- Swap output cannot fund desired auction tokens
- `minPaymentTokensFromSwap` above realistic output
- cofhe capability mismatch on chain

## `COFHE_UNAVAILABLE` or `UNSUPPORTED_DECRYPT_FLOW`

- Inject `@cofhe/sdk` adapter into `createAuctionClient`.
- Ensure both `decryptForView` and `decryptForTx` are wired.

## Price-cap failures

- Use `quoteSwapIntent` before submission.
- Display computed `maxAffordableTokens` to users.

## Contract reachability false in healthcheck

- Verify addresses and Base Sepolia deployment.
- Confirm RPC points to `https://sepolia.base.org`.
