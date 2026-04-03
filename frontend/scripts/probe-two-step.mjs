import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, decodeEventLog, encodeAbiParameters, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { Encryptable } from "@cofhe/sdk";
import { chains } from "@cofhe/sdk/chains";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";

const ZERO_HANDLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const KNOWN_ERRORS = {
  "0x730d2e2a": "PendingPurchaseExists",
  "0x62541316": "PendingPurchaseNotReady",
  "0xf537189c": "PendingPurchaseExpired",
  "0x69b8d0fe": "AuctionNotActive",
  "0x13be252b": "InsufficientAllowance",
  "0x2ee66eed": "PaymentTransferFailed",
  "0x285780d9": "AuctionTransferFailed",
  "0xc907e654": "InvalidDecryptProof",
};

const loadEnv = () => {
  const envPath = path.resolve(".env.local");
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    process.env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
};

const waitForPendingReady = async ({
  client,
  hookAddress,
  abi,
  buyer,
  poolId,
  attempts = 10,
  delayMs = 1200,
}) => {
  let lastPending = null;
  for (let i = 0; i < attempts; i += 1) {
    lastPending = await client.readContract({
      address: hookAddress,
      abi,
      functionName: "getPendingPurchase",
      args: [buyer, poolId],
    });

    if (
      lastPending.auctionId > 0n &&
      lastPending.ready &&
      lastPending.encFinalFill !== ZERO_HANDLE &&
      lastPending.encFinalPayment !== ZERO_HANDLE
    ) {
      return lastPending;
    }

    if (i + 1 < attempts) {
      await sleep(delayMs);
    }
  }

  return lastPending;
};

const waitForPendingClear = async ({
  client,
  hookAddress,
  abi,
  buyer,
  poolId,
  attempts = 10,
  delayMs = 1200,
}) => {
  let lastPending = null;
  for (let i = 0; i < attempts; i += 1) {
    lastPending = await client.readContract({
      address: hookAddress,
      abi,
      functionName: "getPendingPurchase",
      args: [buyer, poolId],
    });
    if (lastPending.auctionId === 0n && !lastPending.ready) {
      return lastPending;
    }
    if (i + 1 < attempts) {
      await sleep(delayMs);
    }
  }
  return lastPending;
};

const describeError = error => {
  if (!(error instanceof Error)) return "Unknown error";
  const match = error.message.match(/0x[0-9a-fA-F]{8}/);
  if (!match) return error.message;
  const label = KNOWN_ERRORS[match[0].toLowerCase()];
  return label ? `${label} (${match[0]})` : error.message;
};

const withRetry = async (fn, { attempts = 6, delayMs = 1500 } = {}) => {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const transient =
        /HTTP 428|HTTP 403|HTTP 404|timeout|temporarily unavailable|rate limit|Too Many Requests/i.test(message);
      if (!transient || i + 1 >= attempts) {
        throw error;
      }
      await sleep(delayMs * (i + 1));
    }
  }
  throw lastError;
};

const hookAbi = [
  {
    type: "function",
    name: "getPendingPurchase",
    stateMutability: "view",
    inputs: [
      { name: "buyer", type: "address" },
      { name: "poolId", type: "bytes32" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "auctionId", type: "uint256" },
          { name: "encAuctionTokens", type: "bytes32" },
          { name: "maxPricePerToken", type: "uint128" },
          { name: "minPaymentTokensFromSwap", type: "uint128" },
          { name: "priceAtIntent", type: "uint128" },
          { name: "paymentOut", type: "uint128" },
          { name: "maxAffordableTokens", type: "uint128" },
          { name: "encFinalFill", type: "bytes32" },
          { name: "encFinalPayment", type: "bytes32" },
          { name: "finalizeDeadline", type: "uint64" },
          { name: "ready", type: "bool" },
          { name: "direct", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "cancelPendingPurchase",
    stateMutability: "nonpayable",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "finalizePendingPurchase",
    stateMutability: "nonpayable",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "paymentResult", type: "uint128" },
      { name: "paymentSignature", type: "bytes" },
      { name: "fillResult", type: "uint128" },
      { name: "fillSignature", type: "bytes" },
    ],
    outputs: [
      { name: "paymentTokensSpent", type: "uint128" },
      { name: "auctionTokensFilled", type: "uint128" },
    ],
  },
  {
    type: "event",
    name: "AuctionSettlementReady",
    anonymous: false,
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "auctionId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "paymentHandle", type: "uint256", indexed: false },
      { name: "fillHandle", type: "uint256", indexed: false },
      { name: "finalizeDeadline", type: "uint64", indexed: false },
      { name: "direct", type: "bool", indexed: false },
    ],
  },
];

const poolManagerAbi = [
  {
    type: "function",
    name: "swap",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "zeroForOne", type: "bool" },
          { name: "amountSpecified", type: "int256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [{ name: "delta", type: "int256" }],
  },
];

const main = async () => {
  loadEnv();

  const rpcUrl = process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  const privateKey = process.env.RELAYER_PRIVATE_KEY;
  if (!privateKey) throw new Error("RELAYER_PRIVATE_KEY is missing in frontend/.env.local");

  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ chain: baseSepolia, transport: http(rpcUrl), account });

  const hookAddress = process.env.NEXT_PUBLIC_HOOK_ADDRESS;
  const poolManagerAddress = process.env.NEXT_PUBLIC_POOL_MANAGER_ADDRESS;
  const poolId = process.env.NEXT_PUBLIC_POOL_ID;
  if (!hookAddress || !poolManagerAddress || !poolId) {
    throw new Error("Missing deployment env values.");
  }

  const poolKey = {
    currency0: process.env.NEXT_PUBLIC_TOKEN0_ADDRESS,
    currency1: process.env.NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS,
    fee: Number(process.env.NEXT_PUBLIC_POOL_FEE || "3000"),
    tickSpacing: Number(process.env.NEXT_PUBLIC_POOL_TICK_SPACING || "60"),
    hooks: hookAddress,
  };

  let pending = await publicClient.readContract({
    address: hookAddress,
    abi: hookAbi,
    functionName: "getPendingPurchase",
    args: [account.address, poolId],
  });

  if (pending.auctionId > 0n) {
    const cancelGas = await publicClient.estimateContractGas({
      address: hookAddress,
      abi: hookAbi,
      functionName: "cancelPendingPurchase",
      args: [poolId],
      account: account.address,
    });
    const cancelHash = await walletClient.writeContract({
      address: hookAddress,
      abi: hookAbi,
      functionName: "cancelPendingPurchase",
      args: [poolId],
      gas: cancelGas,
    });
    await publicClient.waitForTransactionReceipt({ hash: cancelHash });
  }

  const cofhe = createCofheClient(createCofheConfig({ supportedChains: [chains.baseSepolia, chains.sepolia] }));
  await cofhe.connect(publicClient, walletClient);

  const [encrypted] = await cofhe.encryptInputs([Encryptable.uint128(10n)]).setAccount(account.address).execute();
  const hookData = encodeAbiParameters(
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
          { name: "maxPricePerToken", type: "uint128" },
          { name: "minPaymentTokensFromSwap", type: "uint128" },
        ],
      },
    ],
    [
      {
        desiredAuctionTokens: {
          ctHash: encrypted.ctHash,
          securityZone: encrypted.securityZone,
          utype: encrypted.utype,
          signature: encrypted.signature,
        },
        maxPricePerToken: 110n,
        minPaymentTokensFromSwap: 1900n,
      },
    ],
  );

  let swapHash;
  let swapGas;
  let swapGasUsed;
  try {
    swapGas = await publicClient.estimateContractGas({
      address: poolManagerAddress,
      abi: poolManagerAbi,
      functionName: "swap",
      args: [poolKey, { zeroForOne: true, amountSpecified: -2n, sqrtPriceLimitX96: 0n }, hookData],
      account: account.address,
    });
    swapHash = await walletClient.writeContract({
      address: poolManagerAddress,
      abi: poolManagerAbi,
      functionName: "swap",
      args: [poolKey, { zeroForOne: true, amountSpecified: -2n, sqrtPriceLimitX96: 0n }, hookData],
      gas: swapGas,
    });
    const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
    swapGasUsed = swapReceipt.gasUsed;
  } catch (error) {
    throw new Error(`swap failed: ${describeError(error)}`);
  }

  pending = await waitForPendingReady({
    client: publicClient,
    hookAddress,
    abi: hookAbi,
    buyer: account.address,
    poolId,
  });

  if (!pending.ready || pending.encFinalFill === ZERO_HANDLE || pending.encFinalPayment === ZERO_HANDLE) {
    const receipt = await publicClient.getTransactionReceipt({ hash: swapHash });
    const readyEvents = receipt.logs
      .map(log => {
        try {
          return decodeEventLog({ abi: hookAbi, data: log.data, topics: log.topics });
        } catch {
          return undefined;
        }
      })
      .filter(event => event?.eventName === "AuctionSettlementReady");

    throw new Error(
      `swap succeeded but pending not ready (readyEvents=${readyEvents.length}, auctionId=${pending.auctionId.toString()})`,
    );
  }

  const paymentProof = await withRetry(
    () =>
      cofhe
        .decryptForTx(BigInt(pending.encFinalPayment))
        .setChainId(chains.baseSepolia.id)
        .setAccount(account.address)
        .withoutPermit()
        .execute(),
    { attempts: 8, delayMs: 1200 },
  );
  const fillProof = await withRetry(
    () =>
      cofhe
        .decryptForTx(BigInt(pending.encFinalFill))
        .setChainId(chains.baseSepolia.id)
        .setAccount(account.address)
        .withoutPermit()
        .execute(),
    { attempts: 8, delayMs: 1200 },
  );

  let finalizeGas;
  let finalizeHash;
  let finalizeGasUsed;
  try {
    finalizeGas = await publicClient.estimateContractGas({
      address: hookAddress,
      abi: hookAbi,
      functionName: "finalizePendingPurchase",
      args: [poolId, paymentProof.decryptedValue, paymentProof.signature, fillProof.decryptedValue, fillProof.signature],
      account: account.address,
    });
    finalizeHash = await walletClient.writeContract({
      address: hookAddress,
      abi: hookAbi,
      functionName: "finalizePendingPurchase",
      args: [poolId, paymentProof.decryptedValue, paymentProof.signature, fillProof.decryptedValue, fillProof.signature],
      gas: finalizeGas,
    });
    const finalizeReceipt = await publicClient.waitForTransactionReceipt({ hash: finalizeHash });
    finalizeGasUsed = finalizeReceipt.gasUsed;
  } catch (error) {
    throw new Error(`finalize failed: ${describeError(error)}`);
  }

  const pendingAfter = await waitForPendingClear({
    client: publicClient,
    hookAddress,
    abi: hookAbi,
    buyer: account.address,
    poolId,
  });

  console.log(
    JSON.stringify(
      {
        account: account.address,
        deployment: {
          hookAddress,
          poolManagerAddress,
          poolId,
        },
        swap: {
          txHash: swapHash,
          gasEstimate: swapGas.toString(),
          gasUsed: swapGasUsed.toString(),
        },
        finalize: {
          txHash: finalizeHash,
          gasEstimate: finalizeGas.toString(),
          gasUsed: finalizeGasUsed.toString(),
          paymentResult: paymentProof.decryptedValue.toString(),
          fillResult: fillProof.decryptedValue.toString(),
        },
        pendingAfter: {
          auctionId: pendingAfter.auctionId.toString(),
          ready: pendingAfter.ready,
        },
      },
      null,
      2,
    ),
  );
};

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
