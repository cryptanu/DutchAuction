/**
 * Minimal launchpad integration flow.
 *
 * This file intentionally uses pseudo clients. Replace with your viem public/wallet clients,
 * and inject @cofhe/sdk methods into the `cofhe` adapter.
 */

import { createAuctionClient } from "../../packages/sdk-ts/dist/src/index.js";

const addresses = {
  hookAddress: "0x0000000000000000000000000000000000000000",
  poolManagerAddress: "0x0000000000000000000000000000000000000000",
  token0Address: "0x0000000000000000000000000000000000000000",
  paymentTokenAddress: "0x0000000000000000000000000000000000000000",
  auctionTokenAddress: "0x0000000000000000000000000000000000000000",
};

const publicClient = {
  getBlockNumber: async () => 0n,
  getCode: async () => "0x",
  readContract: async () => {
    throw new Error("Replace with viem publicClient.readContract");
  },
};

const walletClient = {
  writeContract: async () => {
    throw new Error("Replace with viem walletClient.writeContract");
  },
};

const cofhe = {
  buildAuctionIntentHookData: async (_intent) => {
    throw new Error("Inject @cofhe/sdk build hookData method");
  },
  decryptForView: async (_input) => {
    throw new Error("Inject @cofhe/sdk decrypt.forView");
  },
  decryptForTx: async (_input) => {
    throw new Error("Inject @cofhe/sdk decrypt.forTx");
  },
};

const client = createAuctionClient({
  chainId: 84532,
  publicClient,
  walletClient,
  addresses,
  pool: {
    fee: 3000,
    tickSpacing: 60,
  },
  cofhe,
});

async function run() {
  const health = await client.healthcheck();
  console.log("health", health);

  const quote = await client.auction.quoteSwapIntent({
    poolId: "0x" + "00".repeat(32),
    swapInput: 10n,
    desiredTokens: 100n,
    maxPrice: 120n,
    minPayment: 9000n,
  });

  console.log("quote", quote);
}

run().catch(console.error);
