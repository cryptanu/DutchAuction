import { Address, Hex, encodeAbiParameters, isAddress, isHex, keccak256 } from "viem";
import { HookDataMode } from "~~/lib/auction/abis";

export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

export type AuctionIntentPlain = {
  desiredAuctionTokens: bigint;
  maxPricePerToken: bigint;
  minPaymentTokensFromSwap: bigint;
};

export type InEProof = {
  ctHash: bigint;
  securityZone: number;
  utype: number;
  signature: Hex;
};

export type HookDataBuildInput = {
  mode: HookDataMode;
  plainIntent: AuctionIntentPlain;
  cofheBuildAuctionIntentHookData?: (intent: {
    desiredAuctionTokens: string;
    maxPricePerToken: string;
    minPaymentTokensFromSwap: string;
  }) => Promise<Hex> | Hex;
  proofs?: {
    desiredAuctionTokens: InEProof;
    maxPricePerToken: InEProof;
    minPaymentTokensFromSwap: InEProof;
  };
};

const ensureProof = (proof: InEProof, label: string): InEProof => {
  if (proof.securityZone < 0 || proof.securityZone > 255) {
    throw new Error(`${label}.securityZone must be in uint8 range.`);
  }
  if (proof.utype < 0 || proof.utype > 255) {
    throw new Error(`${label}.utype must be in uint8 range.`);
  }
  if (!isHex(proof.signature)) {
    throw new Error(`${label}.signature must be hex bytes.`);
  }
  return proof;
};

const buildIntentProofs = (proofs: {
  desiredAuctionTokens: InEProof;
  maxPricePerToken: InEProof;
  minPaymentTokensFromSwap: InEProof;
}): Hex => {
  const desiredProof = ensureProof(proofs.desiredAuctionTokens, "desiredAuctionTokens");
  const maxPriceProof = ensureProof(proofs.maxPricePerToken, "maxPricePerToken");
  const minPaymentProof = ensureProof(proofs.minPaymentTokensFromSwap, "minPaymentTokensFromSwap");

  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          {
            name: "desiredAuctionTokens",
            type: "tuple",
            components: [
              { name: "ctHash", type: "uint256" },
              { name: "securityZone", type: "uint8" },
              { name: "utype", type: "uint8" },
              { name: "signature", type: "bytes" },
            ],
          },
          {
            name: "maxPricePerToken",
            type: "tuple",
            components: [
              { name: "ctHash", type: "uint256" },
              { name: "securityZone", type: "uint8" },
              { name: "utype", type: "uint8" },
              { name: "signature", type: "bytes" },
            ],
          },
          {
            name: "minPaymentTokensFromSwap",
            type: "tuple",
            components: [
              { name: "ctHash", type: "uint256" },
              { name: "securityZone", type: "uint8" },
              { name: "utype", type: "uint8" },
              { name: "signature", type: "bytes" },
            ],
          },
        ],
      },
    ],
    [
      {
        desiredAuctionTokens: desiredProof,
        maxPricePerToken: maxPriceProof,
        minPaymentTokensFromSwap: minPaymentProof,
      },
    ],
  );
};

const buildIntentViaSdk = async (
  intent: AuctionIntentPlain,
  builder: HookDataBuildInput["cofheBuildAuctionIntentHookData"],
): Promise<Hex> => {
  if (!builder) {
    throw new Error(
      "No SDK hookData builder injected. Pass cofheBuildAuctionIntentHookData in buildHookData input.",
    );
  }

  const payload = await builder({
    desiredAuctionTokens: intent.desiredAuctionTokens.toString(),
    maxPricePerToken: intent.maxPricePerToken.toString(),
    minPaymentTokensFromSwap: intent.minPaymentTokensFromSwap.toString(),
  });

  if (!isHex(payload)) {
    throw new Error("SDK builder must return a hex bytes payload.");
  }

  return payload;
};

export const buildHookData = async (input: HookDataBuildInput): Promise<Hex> => {
  switch (input.mode) {
    case "proofs":
      if (!input.proofs) throw new Error("Proof mode requires three InE proof objects.");
      return buildIntentProofs(input.proofs);
    case "sdk":
      return buildIntentViaSdk(input.plainIntent, input.cofheBuildAuctionIntentHookData);
    default:
      throw new Error(`Unsupported hookData mode: ${input.mode as string}`);
  }
};

export const poolKeyToId = (poolKey: PoolKey): Hex => {
  if (!isAddress(poolKey.currency0) || !isAddress(poolKey.currency1) || !isAddress(poolKey.hooks)) {
    throw new Error("Invalid PoolKey addresses.");
  }

  return keccak256(
    encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "currency0", type: "address" },
            { name: "currency1", type: "address" },
            { name: "fee", type: "uint24" },
            { name: "tickSpacing", type: "int24" },
            { name: "hooks", type: "address" },
          ],
        },
      ],
      [poolKey],
    ),
  );
};

export const parseNumericInput = (value: string, label: string): bigint => {
  if (!value.trim()) throw new Error(`${label} is required.`);

  try {
    if (value.trim().startsWith("0x")) {
      return BigInt(value.trim());
    }
    return BigInt(value.trim());
  } catch {
    throw new Error(`${label} must be a valid integer.`);
  }
};
