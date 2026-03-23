# examples-launchpad

Minimal reference integration examples for DeFi launchpad teams.

## Includes

- `src/basic-flow.example.js`: healthcheck + quote flow with SDK API shape.

## Recommended path

1. Build SDK: `corepack yarn --cwd frontend tsc -p ../packages/sdk-ts/tsconfig.json`
2. Replace placeholder clients with your viem clients.
3. Inject `@cofhe/sdk` functions into the SDK `cofhe` adapter.
4. Use this as base for your launchpad checkout flow.
