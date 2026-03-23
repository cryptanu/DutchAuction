import assert from "node:assert/strict";
import test from "node:test";

import { AuctionClientError } from "../src/errors.js";
import { buildHookData } from "../src/hookData.js";
import type { Hex } from "../src/types.js";

const decodeCompactIntentPayload = (payload: Hex) => {
  const data = payload.slice(2);
  const readWord = (index: number): bigint => {
    const start = index * 64;
    return BigInt(`0x${data.slice(start, start + 64)}`);
  };

  const signatureLength = Number(readWord(8));
  const signatureHex = data.slice(9 * 64, 9 * 64 + signatureLength * 2);
  return {
    headOffset: readWord(0),
    desiredOffset: readWord(1),
    maxPricePerToken: readWord(2),
    minPaymentTokensFromSwap: readWord(3),
    ctHash: readWord(4),
    securityZone: readWord(5),
    utype: readWord(6),
    signatureOffset: readWord(7),
    signature: (`0x${signatureHex}` as Hex),
  };
};

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

test("buildHookData proof mode encodes hookData without cofhe proof builder", async () => {
  const payload = await buildHookData({
    mode: "proofs",
    plainIntent: {
      desiredAuctionTokens: 10n,
      maxPricePerToken: 11n,
      minPaymentTokensFromSwap: 12n,
    },
    proofs: {
      desiredAuctionTokens: { ctHash: 1n, securityZone: 0, utype: 6, signature: "0x" },
    },
  });

  const decoded = decodeCompactIntentPayload(payload);

  assert.equal(decoded.headOffset, 32n);
  assert.equal(decoded.desiredOffset, 96n);
  assert.equal(decoded.ctHash, 1n);
  assert.equal(decoded.maxPricePerToken, 11n);
  assert.equal(decoded.minPaymentTokensFromSwap, 12n);
});

test("buildHookData proof mode validates required tuple fields", async () => {
  await assert.rejects(
    () =>
      buildHookData(
        {
          mode: "proofs",
          plainIntent: {
            desiredAuctionTokens: 10n,
            maxPricePerToken: 11n,
            minPaymentTokensFromSwap: 12n,
          },
          proofs: {
            desiredAuctionTokens: { ctHash: 0n, securityZone: 0, utype: 6, signature: "0x" },
          },
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof AuctionClientError);
      assert.equal((error as AuctionClientError).code, "INVALID_INPUT");
      assert.match((error as AuctionClientError).message, /ctHash must be > 0/i);
      return true;
    },
  );
});

test("buildHookData proof mode sanitizes and encodes only required proof fields", async () => {
  const payload = await buildHookData(
    {
      mode: "proofs",
      plainIntent: {
        desiredAuctionTokens: 10n,
        maxPricePerToken: 11n,
        minPaymentTokensFromSwap: 12n,
      },
      proofs: {
        desiredAuctionTokens: {
          ctHash: 1n,
          securityZone: 0,
          utype: 6,
          signature: "0x",
          extra: "drop-me",
        } as unknown as {
          ctHash: bigint;
          securityZone: number;
          utype: number;
          signature: Hex;
        },
      },
    },
  );

  const decoded = decodeCompactIntentPayload(payload);
  assert.equal(decoded.ctHash, 1n);
  assert.equal(decoded.securityZone, 0n);
  assert.equal(decoded.utype, 6n);
  assert.equal(decoded.signature, "0x");
  assert.equal(decoded.signatureOffset, 128n);
  assert.equal(decoded.maxPricePerToken, 11n);
  assert.equal(decoded.minPaymentTokensFromSwap, 12n);
});
