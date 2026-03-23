import assert from "node:assert/strict";
import test from "node:test";

import { AuctionClientError } from "../src/errors.js";
import { buildHookData } from "../src/hookData.js";
import type { Hex } from "../src/types.js";

test("buildHookData sdk mode uses injected cofhe builder", async () => {
  const hookData = await buildHookData(
    {
      mode: "sdk",
      plainIntent: {
        desiredAuctionTokens: 10n,
        maxPricePerToken: 11n,
        minPaymentTokensFromSwap: 12n,
      },
    },
    {
      buildAuctionIntentHookData: async () => "0x1234" as Hex,
    },
  );

  assert.equal(hookData, "0x1234");
});

test("buildHookData proof mode throws when proof builder is missing", async () => {
  await assert.rejects(
    () =>
      buildHookData({
        mode: "proofs",
        plainIntent: {
          desiredAuctionTokens: 10n,
          maxPricePerToken: 11n,
          minPaymentTokensFromSwap: 12n,
        },
        proofs: {
          desiredAuctionTokens: { ctHash: 1n, securityZone: 0, utype: 6, signature: "0x" },
          maxPricePerToken: { ctHash: 2n, securityZone: 0, utype: 6, signature: "0x" },
          minPaymentTokensFromSwap: { ctHash: 3n, securityZone: 0, utype: 6, signature: "0x" },
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof AuctionClientError);
      assert.equal((error as AuctionClientError).code, "HOOKDATA_PROOF_UNAVAILABLE");
      return true;
    },
  );
});
