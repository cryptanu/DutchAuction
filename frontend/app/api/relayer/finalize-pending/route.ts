import { NextResponse } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import { Address, Hex, createPublicClient, createWalletClient, http, isAddress, isHex } from "viem";
import { baseSepolia } from "viem/chains";
import { stealthDutchAuctionHookAbi } from "~~/lib/auction/abis";
import { auctionConfig } from "~~/lib/auction/config";

export const runtime = "nodejs";

type FinalizeProof = {
  value: string;
  signature: Hex;
};

type FinalizeRequestBody = {
  buyer: Address;
  poolId: Hex;
  paymentProof: FinalizeProof;
  fillProof: FinalizeProof;
};

const HEX_32_LENGTH = 66;
const ADDRESS_LENGTH = 42;

const parseUint128 = (value: string, label: string): bigint => {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} must be a numeric string.`);
  }
  if (parsed < 0n || parsed > (1n << 128n) - 1n) {
    throw new Error(`${label} must fit uint128.`);
  }
  return parsed;
};

const parseBody = (value: unknown): FinalizeRequestBody => {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid request body.");
  }

  const body = value as Record<string, unknown>;
  const buyer = String(body.buyer || "") as Address;
  const poolId = String(body.poolId || "") as Hex;

  if (!isAddress(buyer) || buyer.length !== ADDRESS_LENGTH) {
    throw new Error("buyer must be a valid address.");
  }
  if (!isHex(poolId) || poolId.length !== HEX_32_LENGTH) {
    throw new Error("poolId must be 32-byte hex.");
  }

  const paymentProofRaw = body.paymentProof as Record<string, unknown> | undefined;
  const fillProofRaw = body.fillProof as Record<string, unknown> | undefined;
  if (!paymentProofRaw || !fillProofRaw) {
    throw new Error("paymentProof and fillProof are required.");
  }

  const paymentSignature = String(paymentProofRaw.signature || "") as Hex;
  const fillSignature = String(fillProofRaw.signature || "") as Hex;
  if (!isHex(paymentSignature) || !isHex(fillSignature)) {
    throw new Error("proof signatures must be hex bytes.");
  }

  return {
    buyer,
    poolId,
    paymentProof: {
      value: String(paymentProofRaw.value ?? ""),
      signature: paymentSignature,
    },
    fillProof: {
      value: String(fillProofRaw.value ?? ""),
      signature: fillSignature,
    },
  };
};

const getRelayerContext = () => {
  const relayerPk = process.env.RELAYER_PRIVATE_KEY as Hex | undefined;
  if (!relayerPk || !/^0x[0-9a-fA-F]{64}$/.test(relayerPk)) {
    throw new Error("RELAYER_PRIVATE_KEY is missing or invalid.");
  }

  const hookAddress = (process.env.RELAYER_HOOK_ADDRESS || auctionConfig.hookAddress) as Address | undefined;
  if (!hookAddress || !isAddress(hookAddress)) {
    throw new Error("RELAYER_HOOK_ADDRESS is missing or invalid.");
  }

  const rpcUrl = process.env.RELAYER_RPC_URL || process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  return { relayerPk, hookAddress, rpcUrl };
};

export async function POST(request: Request) {
  try {
    const payload = parseBody(await request.json());
    const { relayerPk, hookAddress, rpcUrl } = getRelayerContext();

    const account = privateKeyToAccount(relayerPk);
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(rpcUrl),
    });
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(rpcUrl),
    });

    const paymentValue = parseUint128(payload.paymentProof.value, "paymentProof.value");
    const fillValue = parseUint128(payload.fillProof.value, "fillProof.value");

    const txHash = await walletClient.writeContract({
      address: hookAddress,
      abi: stealthDutchAuctionHookAbi,
      functionName: "finalizePendingPurchaseFor",
      args: [
        payload.buyer,
        payload.poolId,
        paymentValue,
        payload.paymentProof.signature,
        fillValue,
        payload.fillProof.signature,
      ],
    });

    // Early read of receipt status for easier client diagnostics. Non-blocking if still pending.
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });

    return NextResponse.json({
      ok: true,
      txHash,
      status: receipt.status,
      relayer: account.address,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Relayer finalize failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

