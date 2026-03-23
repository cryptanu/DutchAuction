import assert from "node:assert/strict";
import test from "node:test";

import { createAuctionClient } from "../src/client.js";
import { AuctionClientError } from "../src/errors.js";
import type { AuctionClientConfig, ContractReadRequest, ContractWriteRequest, Hex } from "../src/types.js";

const ADDRESSES = {
  hookAddress: "0x1111111111111111111111111111111111111111",
  poolManagerAddress: "0x2222222222222222222222222222222222222222",
  token0Address: "0x3333333333333333333333333333333333333333",
  paymentTokenAddress: "0x4444444444444444444444444444444444444444",
  auctionTokenAddress: "0x5555555555555555555555555555555555555555",
} as const;

const POOL_ID = ("0x" + "ab".repeat(32)) as Hex;

const createMockConfig = (): AuctionClientConfig & { writes: ContractWriteRequest[] } => {
  const writes: ContractWriteRequest[] = [];

  const publicClient = {
    chain: { id: 84532 },
    getBlockNumber: async () => 10n,
    getCode: async () => "0x01" as const,
    readContract: async (input: ContractReadRequest) => {
      if (input.functionName === "poolAuctions") {
        return [POOL_ID, ADDRESSES.auctionTokenAddress, ADDRESSES.paymentTokenAddress, 1n] as const;
      }
      if (input.functionName === "getAuctionPlainState") {
        return [
          "0x6666666666666666666666666666666666666666",
          true,
          100n,
          50n,
          63n,
          10n,
          1000n,
          1_700_000_000n,
          86_400n,
        ] as const;
      }
      if (input.functionName === "auctions") {
        return [
          ("0x" + "01".repeat(32)) as Hex,
          ("0x" + "02".repeat(32)) as Hex,
          ("0x" + "03".repeat(32)) as Hex,
          ("0x" + "04".repeat(32)) as Hex,
          ("0x" + "05".repeat(32)) as Hex,
          ("0x" + "06".repeat(32)) as Hex,
          ("0x" + "07".repeat(32)) as Hex,
          "0x6666666666666666666666666666666666666666",
          100n,
          50n,
          1_700_000_000n,
          86_400n,
          1_000n,
          10n,
          true,
        ] as const;
      }
      if (input.functionName === "pools") {
        return [
          {
            currency0: ADDRESSES.token0Address,
            currency1: ADDRESSES.paymentTokenAddress,
            fee: 3000,
            tickSpacing: 60,
            hooks: ADDRESSES.hookAddress,
          },
          1000n,
          1n,
          true,
        ] as const;
      }
      throw new Error(`Unexpected read function: ${input.functionName}`);
    },
  };

  const walletClient = {
    chain: { id: 84532 },
    account: { address: "0x7777777777777777777777777777777777777777" as const },
    writeContract: async (input: ContractWriteRequest) => {
      writes.push(input);
      return ("0x" + "12".repeat(32)) as Hex;
    },
  };

  return {
    chainId: 84532,
    publicClient,
    walletClient,
    addresses: ADDRESSES,
    pool: {
      fee: 3000,
      tickSpacing: 60,
    },
    cofhe: {
      buildAuctionIntentHookData: async () => "0x1234" as Hex,
      decryptForView: async () => ({ clear: 42 }),
      decryptForTx: async () => ({ onchain: true }),
    },
    writes,
  };
};

test("healthcheck reports rpc/contracts/cofhe capability", async () => {
  const config = createMockConfig();
  const client = createAuctionClient(config);

  const health = await client.healthcheck();
  assert.equal(health.rpc, true);
  assert.equal(health.cofheAvailable, true);
  assert.equal(health.decryptForView, true);
  assert.equal(health.decryptForTx, true);
  assert.equal(health.contractReachability.hook, true);
});

test("getState returns plain + encrypted metadata", async () => {
  const config = createMockConfig();
  const client = createAuctionClient(config);

  const state = await client.auction.getState({ poolId: POOL_ID });
  assert.equal(state.currentPrice, 63n);
  assert.equal(state.encrypted.startPriceHandle, ("0x" + "01".repeat(32)) as Hex);
  assert.equal(state.encrypted.isActiveHandle, ("0x" + "07".repeat(32)) as Hex);
});

test("quoteSwapIntent returns insufficient output reason when underfunded", async () => {
  const config = createMockConfig();
  const client = createAuctionClient(config);

  const quote = await client.auction.quoteSwapIntent({
    poolId: POOL_ID,
    swapInput: 2n,
    desiredTokens: 100n,
    maxPrice: 63n,
    minPayment: 1900n,
  });

  assert.equal(quote.expectedPaymentOut, 2000n);
  assert.equal(quote.requiredPaymentAtCurrentPrice, 6300n);
  assert.equal(quote.affordable, false);
  assert.equal(quote.reason, "INSUFFICIENT_SWAP_OUTPUT");
  assert.equal(quote.maxAffordableTokens, 31n);
});

test("swapAndBuy fails fast with deterministic error code", async () => {
  const config = createMockConfig();
  const client = createAuctionClient(config);

  await assert.rejects(
    () =>
      client.auction.swapAndBuy({
        poolId: POOL_ID,
        swapInput: 2n,
        mode: "sdk",
        intent: {
          desiredAuctionTokens: 100n,
          maxPricePerToken: 63n,
          minPaymentTokensFromSwap: 1900n,
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof AuctionClientError);
      assert.equal((error as AuctionClientError).code, "INSUFFICIENT_SWAP_OUTPUT");
      return true;
    },
  );
  assert.equal(config.writes.length, 0);
});

test("swapAndBuy submits tx when quote is affordable", async () => {
  const config = createMockConfig();
  const client = createAuctionClient(config);

  const txHash = await client.auction.swapAndBuy({
    poolId: POOL_ID,
    swapInput: 10n,
    mode: "sdk",
    intent: {
      desiredAuctionTokens: 100n,
      maxPricePerToken: 100n,
      minPaymentTokensFromSwap: 9000n,
    },
  });

  assert.match(txHash, /^0x[0-9a-f]+$/i);
  assert.equal(config.writes.length, 1);
  assert.equal(config.writes[0]?.functionName, "swap");
});

test("buyWithPaymentToken plain path is disabled", async () => {
  const config = createMockConfig();
  const client = createAuctionClient(config);

  await assert.rejects(
    () =>
      client.auction.buyWithPaymentToken({
        poolId: POOL_ID,
        desiredAuctionTokens: 10n,
        maxPricePerToken: 100n,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AuctionClientError);
      assert.equal((error as AuctionClientError).code, "UNSUPPORTED_DECRYPT_FLOW");
      return true;
    },
  );
});

test("buyWithPaymentTokenEncrypted submits encrypted direct buy tx", async () => {
  const config = createMockConfig();
  const client = createAuctionClient(config);

  const txHash = await client.auction.buyWithPaymentTokenEncrypted({
    poolId: POOL_ID,
    desiredAuctionTokens: { ctHash: 101n, securityZone: 0, utype: 6, signature: "0x" },
    maxPricePerToken: 102n,
  });

  assert.match(txHash, /^0x[0-9a-f]+$/i);
  assert.equal(config.writes.length, 1);
  assert.equal(config.writes[0]?.functionName, "buyWithPaymentTokenEncrypted");
});

test("buyWithPaymentTokenEncrypted rejects placeholder proof tuples", async () => {
  const config = createMockConfig();
  const client = createAuctionClient(config);

  await assert.rejects(
    () =>
      client.auction.buyWithPaymentTokenEncrypted({
        poolId: POOL_ID,
        desiredAuctionTokens: { ctHash: 0n, securityZone: 0, utype: 6, signature: "0x" },
        maxPricePerToken: 102n,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AuctionClientError);
      assert.equal((error as AuctionClientError).code, "INVALID_INPUT");
      assert.match((error as AuctionClientError).message, /ctHash must be > 0/i);
      return true;
    },
  );

  assert.equal(config.writes.length, 0);
});

test("decrypt flows map to explicit view/tx methods", async () => {
  const config = createMockConfig();
  const client = createAuctionClient(config);

  const viewResult = await client.decrypt.forView<{ clear: number }>({ handle: "0x1234" });
  assert.equal(viewResult.clear, 42);

  const txResult = await client.decrypt.forTx<{ onchain: boolean }>({ handle: "0x5678", policy: "auction" });
  assert.equal(txResult.onchain, true);
});
