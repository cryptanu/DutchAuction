import assert from "node:assert/strict";
import test from "node:test";

import { AuctionClientError } from "../src/errors.js";
import { loadAuctionEnv } from "../src/config.js";

test("loadAuctionEnv parses canonical env schema", () => {
  const parsed = loadAuctionEnv({
    NEXT_PUBLIC_HOOK_ADDRESS: "0x1111111111111111111111111111111111111111",
    NEXT_PUBLIC_POOL_MANAGER_ADDRESS: "0x2222222222222222222222222222222222222222",
    NEXT_PUBLIC_TOKEN0_ADDRESS: "0x3333333333333333333333333333333333333333",
    NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS: "0x4444444444444444444444444444444444444444",
    NEXT_PUBLIC_AUCTION_TOKEN_ADDRESS: "0x5555555555555555555555555555555555555555",
    NEXT_PUBLIC_POOL_FEE: "3000",
    NEXT_PUBLIC_POOL_TICK_SPACING: "60",
  });

  assert.equal(parsed.pool.fee, 3000);
  assert.equal(parsed.pool.tickSpacing, 60);
  assert.equal(parsed.addresses.hookAddress, "0x1111111111111111111111111111111111111111");
});

test("loadAuctionEnv throws on invalid address", () => {
  assert.throws(
    () =>
      loadAuctionEnv({
        NEXT_PUBLIC_HOOK_ADDRESS: "not-address",
        NEXT_PUBLIC_POOL_MANAGER_ADDRESS: "0x2222222222222222222222222222222222222222",
        NEXT_PUBLIC_TOKEN0_ADDRESS: "0x3333333333333333333333333333333333333333",
        NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS: "0x4444444444444444444444444444444444444444",
        NEXT_PUBLIC_AUCTION_TOKEN_ADDRESS: "0x5555555555555555555555555555555555555555",
      }),
    (error: unknown) => {
      assert.ok(error instanceof AuctionClientError);
      assert.equal((error as AuctionClientError).code, "INVALID_CONFIG");
      return true;
    },
  );
});
