import { Address, Hex, decodeAbiParameters, encodeAbiParameters, isAddress, isHex, keccak256 } from "viem";
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
  };
};

const PROOF_TUPLE_COMPONENTS = [
  { name: "ctHash", type: "uint256" },
  { name: "securityZone", type: "uint8" },
  { name: "utype", type: "uint8" },
  { name: "signature", type: "bytes" },
] as const;

const PROOFS_ABI = [
  {
    type: "tuple",
    components: [
      { name: "desiredAuctionTokens", type: "tuple", components: PROOF_TUPLE_COMPONENTS },
      { name: "maxPricePerToken", type: "uint128" },
      { name: "minPaymentTokensFromSwap", type: "uint128" },
    ],
  },
] as const;

export const ensureProofRequiredFields = (proof: InEProof, label: string): InEProof => {
  if (proof.ctHash <= 0n) {
    throw new Error(`${label}.ctHash must be > 0.`);
  }
  if (!Number.isInteger(proof.securityZone) || proof.securityZone < 0 || proof.securityZone > 255) {
    throw new Error(`${label}.securityZone must be in uint8 range.`);
  }
  if (!Number.isInteger(proof.utype) || proof.utype < 0 || proof.utype > 255) {
    throw new Error(`${label}.utype must be in uint8 range.`);
  }
  if (!isHex(proof.signature)) {
    throw new Error(`${label}.signature must be hex bytes.`);
  }
  // Return only required InE tuple fields used by contract verification.
  return {
    ctHash: proof.ctHash,
    securityZone: proof.securityZone,
    utype: proof.utype,
    signature: proof.signature,
  };
};

export const encodeIntentProofs = (
  proofs: {
    desiredAuctionTokens: InEProof;
  },
  plainIntent: AuctionIntentPlain,
): Hex => {
  const desiredProof = ensureProofRequiredFields(proofs.desiredAuctionTokens, "desiredAuctionTokens");
  if (plainIntent.maxPricePerToken < 0n || plainIntent.minPaymentTokensFromSwap < 0n) {
    throw new Error("maxPricePerToken and minPaymentTokensFromSwap must be >= 0.");
  }

  return encodeAbiParameters(
    PROOFS_ABI,
    [
      {
        desiredAuctionTokens: desiredProof,
        maxPricePerToken: plainIntent.maxPricePerToken,
        minPaymentTokensFromSwap: plainIntent.minPaymentTokensFromSwap,
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

export const decodeIntentProofs = (payload: Hex): {
  desiredAuctionTokens: InEProof;
  maxPricePerToken: bigint;
  minPaymentTokensFromSwap: bigint;
} => {
  const [decoded] = decodeAbiParameters(PROOFS_ABI, payload);
  return {
    desiredAuctionTokens: ensureProofRequiredFields(decoded.desiredAuctionTokens, "desiredAuctionTokens"),
    maxPricePerToken: decoded.maxPricePerToken,
    minPaymentTokensFromSwap: decoded.minPaymentTokensFromSwap,
  };
};

export const deriveIntentProofsViaSdkBuilder = async (
  intent: AuctionIntentPlain,
  builder: HookDataBuildInput["cofheBuildAuctionIntentHookData"],
): Promise<{
  desiredAuctionTokens: InEProof;
}> => {
  const payload = await buildIntentViaSdk(intent, builder);
  const decoded = decodeIntentProofs(payload);
  return {
    desiredAuctionTokens: decoded.desiredAuctionTokens,
  };
};

export const buildHookData = async (input: HookDataBuildInput): Promise<Hex> => {
  switch (input.mode) {
    case "proofs":
      if (!input.proofs) throw new Error("Proof mode requires desiredAuctionTokens encrypted proof.");
      return encodeIntentProofs(input.proofs, input.plainIntent);
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
