import assert from "node:assert/strict";
import test from "node:test";

import { AuctionClientError } from "../src/errors.js";
import { fromCofheSdk, wrapDeprecatedCofhejs } from "../src/migration.js";

test("wrapDeprecatedCofhejs fails closed for legacy flow", async () => {
  const adapter = wrapDeprecatedCofhejs({ decrypt: () => 1 });
  assert.ok(adapter.decryptForView);

  await assert.rejects(
    () => adapter.decryptForView!({ handle: "0x1234" }),
    (error: unknown) => {
      assert.ok(error instanceof AuctionClientError);
      assert.equal((error as AuctionClientError).code, "UNSUPPORTED_DECRYPT_FLOW");
      return true;
    },
  );
});

test("fromCofheSdk maps nested decrypt methods", async () => {
  const adapter = fromCofheSdk({
    decrypt: {
      forView: async () => "view-ok",
      forTx: async () => "tx-ok",
    },
    buildAuctionIntentHookData: async () => "0x01",
  });

  const view = await adapter.decryptForView?.({ handle: "0xaaaa" });
  const tx = await adapter.decryptForTx?.({ handle: "0xbbbb" });
  const payload = await adapter.buildAuctionIntentHookData?.({
    desiredAuctionTokens: "1",
    maxPricePerToken: "2",
    minPaymentTokensFromSwap: "3",
  });

  assert.equal(view, "view-ok");
  assert.equal(tx, "tx-ok");
  assert.equal(payload, "0x01");
});
