"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Address, Hex, decodeEventLog, isAddress, isHex } from "viem";
import { baseSepolia } from "viem/chains";
import {
  useAccount,
  useBlockNumber,
  usePublicClient,
  useReadContract,
  useWalletClient,
  useWaitForTransactionReceipt,
  useWatchContractEvent,
  useWriteContract,
} from "wagmi";
import {
  HookDataMode,
  mockFherc20Abi,
  mockPoolManagerAbi,
  stealthDutchAuctionHookAbi,
} from "~~/lib/auction/abis";
import { auctionConfig, isAuctionConfigReady, relayerConfig, requiredEnvKeys } from "~~/lib/auction/config";
import {
  getCofheHookDataBuilder,
  installCofheInjectionHelpersOnWindow,
  tryAutoInjectCofheHookDataBuilderFromWindow,
} from "~~/lib/auction/cofheAdapter";
import { createFrontendAuctionClient } from "~~/lib/auction/sdkClient";
import {
  decryptHandleForTxViaCofheSdk,
  deriveIntentProofsViaCofheSdk,
  initializeCofheSdkBuilder,
} from "~~/lib/auction/cofheSdkBootstrap";
import {
  InEProof,
  PoolKey,
  buildHookData,
  deriveIntentProofsViaSdkBuilder,
  parseNumericInput,
  poolKeyToId,
} from "~~/lib/auction/encoding";
import { formatInt, formatTimeRemaining, shortAddress } from "~~/lib/auction/format";

const MAX_UINT256 = (1n << 256n) - 1n;
const EVENT_LOOKBACK_BLOCKS = 80_000n;
const MAX_LOG_QUERY_RANGE = 9_999n;
const DEFAULT_PROOF_JSON = '{"ctHash":"0","securityZone":0,"utype":6,"signature":"0x"}';
const TASK_MANAGER_ADDRESS = "0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9" as Address;
const ZERO_HANDLE = ("0x" + "0".repeat(64)) as Hex;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const taskManagerVerifyInputAbi = [
  {
    type: "function",
    name: "verifyInput",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "input",
        type: "tuple",
        components: [
          { name: "ctHash", type: "uint256" },
          { name: "securityZone", type: "uint8" },
          { name: "utype", type: "uint8" },
          { name: "signature", type: "bytes" },
        ],
      },
      { name: "sender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

type PoolAuctionTuple = readonly [Hex, Address, Address, bigint];
type AuctionPlainStateTuple = readonly [Address, boolean, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
type PoolConfigTuple = readonly [PoolKey, bigint, bigint, boolean];
type PendingPurchaseTuple = {
  auctionId: bigint;
  encAuctionTokens: Hex;
  maxPricePerToken: bigint;
  minPaymentTokensFromSwap: bigint;
  priceAtIntent: bigint;
  paymentOut: bigint;
  maxAffordableTokens: bigint;
  encFinalFill: Hex;
  encFinalPayment: Hex;
  finalizeDeadline: bigint;
  ready: boolean;
  direct: boolean;
};
type SdkHealthcheck = Awaited<ReturnType<ReturnType<typeof createFrontendAuctionClient>["healthcheck"]>>;

type ActivityItem = {
  id: string;
  title: string;
  detail: string;
  blockNumber: bigint;
  txHash: Hex;
};

type PendingFromEvent = {
  auctionId: bigint;
  paymentHandle: Hex;
  fillHandle: Hex;
  finalizeDeadline: bigint;
  direct: boolean;
};

const isSameAddress = (lhs?: Address, rhs?: Address): boolean => {
  if (!lhs || !rhs) return false;
  return lhs.toLowerCase() === rhs.toLowerCase();
};

const parseProofJson = (value: string, label: string): InEProof => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} JSON is invalid.`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${label} must be a JSON object.`);
  }

  const raw = parsed as Record<string, unknown>;
  for (const field of ["ctHash", "securityZone", "utype", "signature"] as const) {
    if (!(field in raw)) {
      throw new Error(`${label}.${field} is required.`);
    }
  }

  const ctHash =
    typeof raw.ctHash === "number" ? BigInt(raw.ctHash) : parseNumericInput(String(raw.ctHash ?? ""), `${label}.ctHash`);

  const proof = {
    ctHash,
    securityZone: Number(raw.securityZone),
    utype: Number(raw.utype),
    signature: String(raw.signature) as Hex,
  };

  if (proof.ctHash < 0n) {
    throw new Error(`${label}.ctHash must be >= 0.`);
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

  return proof;
};

const isProofPlaceholder = (proof: InEProof): boolean => proof.ctHash === 0n;

const shortHash = (hash: Hex | undefined): string => {
  if (!hash) return "-";
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
};

const KNOWN_ERROR_SIGNATURES: Record<string, string> = {
  "0x730d2e2a": "Pending purchase already exists for this wallet. Finalize or cancel it first.",
  "0x62541316": "No pending purchase is ready to finalize yet.",
  "0xf537189c": "Pending purchase finalize window expired. Submit a new intent.",
  "0x69b8d0fe": "Auction is not active.",
  "0x13be252b": "Insufficient allowance. Re-run approvals for this deployment.",
  "0x2ee66eed": "Encrypted payment transfer failed.",
  "0x285780d9": "Encrypted auction transfer failed.",
  "0xc907e654": "Decrypt proof verification failed.",
};

const parseError = (err: unknown): string => {
  if (err instanceof Error && err.message) {
    const maybeCode = (err as Error & { code?: string }).code;
    const signatureMatch = err.message.match(/0x[0-9a-fA-F]{8}/);
    if (signatureMatch) {
      const signature = signatureMatch[0].toLowerCase();
      const mapped = KNOWN_ERROR_SIGNATURES[signature];
      if (mapped) {
        return mapped;
      }
    }

    if (/exceeds max(imum)? per-transaction gas limit|exceeds max transaction gas limit/i.test(err.message)) {
      return "RPC gas cap exceeded during estimation. This usually means invalid inputs for the current state (or stale pending state), not necessarily high runtime gas.";
    }

    return maybeCode ? `[${maybeCode}] ${err.message}` : err.message;
  }
  return "Transaction failed.";
};

const toActivity = (
  decoded: { eventName: string; args: unknown },
  txHash: Hex,
  blockNumber: bigint,
  logIndex: bigint,
): ActivityItem => {
  switch (decoded.eventName) {
    case "PoolAuctionInitialized": {
      const args = decoded.args as { auctionId: bigint; seller: Address };
      return {
        id: `${txHash}-${logIndex.toString()}`,
        title: "Pool auction initialized",
        detail: `Auction #${args.auctionId.toString()} by ${shortAddress(args.seller)}`,
        blockNumber,
        txHash,
      };
    }
    case "AuctionIntentRegistered": {
      const args = decoded.args as { auctionId: bigint; buyer: Address };
      return {
        id: `${txHash}-${logIndex.toString()}`,
        title: "Buyer intent registered",
        detail: `${shortAddress(args.buyer)} queued for auction #${args.auctionId.toString()}`,
        blockNumber,
        txHash,
      };
    }
    case "AuctionPurchase": {
      const args = decoded.args as { auctionId: bigint; buyer: Address; timestamp: bigint };
      return {
        id: `${txHash}-${logIndex.toString()}`,
        title: "Auction purchase settled",
        detail: `${shortAddress(args.buyer)} settled on auction #${args.auctionId.toString()} at t=${args.timestamp.toString()}`,
        blockNumber,
        txHash,
      };
    }
    case "AuctionSettlementReady": {
      const args = decoded.args as { auctionId: bigint; buyer: Address; finalizeDeadline: bigint; direct: boolean };
      return {
        id: `${txHash}-${logIndex.toString()}`,
        title: "Settlement pending finalize",
        detail: `${shortAddress(args.buyer)} pending #${args.auctionId.toString()} (${args.direct ? "direct" : "swap"}) until ${args.finalizeDeadline.toString()}`,
        blockNumber,
        txHash,
      };
    }
    case "AuctionSoldOut": {
      const args = decoded.args as { auctionId: bigint };
      return {
        id: `${txHash}-${logIndex.toString()}`,
        title: "Auction sold out",
        detail: `Auction #${args.auctionId.toString()} fully allocated`,
        blockNumber,
        txHash,
      };
    }
    case "AuctionExpired": {
      const args = decoded.args as { auctionId: bigint };
      return {
        id: `${txHash}-${logIndex.toString()}`,
        title: "Auction expired",
        detail: `Auction #${args.auctionId.toString()} reached end time`,
        blockNumber,
        txHash,
      };
    }
    default:
      return {
        id: `${txHash}-${logIndex.toString()}`,
        title: decoded.eventName,
        detail: "Event captured",
        blockNumber,
        txHash,
      };
  }
};

const Home = () => {
  const { address: connectedAddress, chain } = useAccount();
  const { data: blockNumber } = useBlockNumber({ watch: true, chainId: baseSepolia.id });
  const publicClient = usePublicClient({ chainId: baseSepolia.id });
  const { data: walletClient } = useWalletClient({ chainId: baseSepolia.id });
  const { writeContractAsync } = useWriteContract();

  const [nowSec, setNowSec] = useState<bigint>(BigInt(Math.floor(Date.now() / 1000)));

  const [adminStartPrice, setAdminStartPrice] = useState("100");
  const [adminEndPrice, setAdminEndPrice] = useState("50");
  const [adminDuration, setAdminDuration] = useState("86400");
  const [adminSupply, setAdminSupply] = useState("1000");
  const [adminSeller, setAdminSeller] = useState(auctionConfig.defaultSeller ?? "");

  const [swapInput, setSwapInput] = useState("2");
  const [desiredTokens, setDesiredTokens] = useState("10");
  const [maxPrice, setMaxPrice] = useState("110");
  const [minPaymentOut, setMinPaymentOut] = useState("1900");
  const [hookDataMode, setHookDataMode] = useState<HookDataMode>("proofs");
  const [desiredProof, setDesiredProof] = useState(DEFAULT_PROOF_JSON);

  const [mintToken0Amount, setMintToken0Amount] = useState("1000");
  const [mintAuctionAmount, setMintAuctionAmount] = useState("1000");

  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [pendingTxHash, setPendingTxHash] = useState<Hex | undefined>();
  const [pendingTxLabel, setPendingTxLabel] = useState("");
  const [sdkHealth, setSdkHealth] = useState<SdkHealthcheck | undefined>();
  const [sdkHealthError, setSdkHealthError] = useState<string | undefined>();
  const [cofheInitError, setCofheInitError] = useState<string | undefined>();
  const [cofheBuilderReady, setCofheBuilderReady] = useState<boolean>(Boolean(getCofheHookDataBuilder()));
  const [pendingFromEvent, setPendingFromEvent] = useState<PendingFromEvent | undefined>();
  const useRelayerFinalize = false;
  const [relayerBusy, setRelayerBusy] = useState(false);

  const createSdkClient = useCallback(() => {
    if (!publicClient || !isAuctionConfigReady) return undefined;
    const builder = getCofheHookDataBuilder();
    return createFrontendAuctionClient({
      publicClient: {
        getBlockNumber: publicClient.getBlockNumber,
        getCode: async ({ address }) => {
          const code = await publicClient.getCode({ address });
          return (code ?? "0x") as Hex;
        },
        readContract: publicClient.readContract,
      },
      writeContractAsync,
      accountAddress: connectedAddress,
      addresses: {
        hookAddress: auctionConfig.hookAddress! as Hex,
        poolManagerAddress: auctionConfig.poolManagerAddress! as Hex,
        token0Address: auctionConfig.token0Address! as Hex,
        paymentTokenAddress: auctionConfig.paymentTokenAddress! as Hex,
        auctionTokenAddress: auctionConfig.auctionTokenAddress! as Hex,
      },
      pool: {
        fee: auctionConfig.poolFee,
        tickSpacing: auctionConfig.poolTickSpacing,
      },
      cofhe: builder
        ? {
            buildAuctionIntentHookData: builder
          }
        : undefined,
    });
  }, [publicClient, writeContractAsync, connectedAddress]);

  const poolKey = useMemo<PoolKey | undefined>(() => {
    if (!isAuctionConfigReady) return undefined;

    return {
      currency0: auctionConfig.token0Address!,
      currency1: auctionConfig.paymentTokenAddress!,
      fee: auctionConfig.poolFee,
      tickSpacing: auctionConfig.poolTickSpacing,
      hooks: auctionConfig.hookAddress!,
    };
  }, []);

  const poolId = useMemo<Hex | undefined>(() => {
    if (auctionConfig.poolIdOverride) return auctionConfig.poolIdOverride;
    if (!poolKey) return undefined;
    return poolKeyToId(poolKey);
  }, [poolKey, auctionConfig.poolIdOverride]);

  const { data: poolAuctionRaw, refetch: refetchPoolAuction } = useReadContract({
    chainId: baseSepolia.id,
    address: auctionConfig.hookAddress,
    abi: stealthDutchAuctionHookAbi,
    functionName: "poolAuctions",
    args: poolId ? [poolId] : undefined,
    query: {
      enabled: Boolean(auctionConfig.hookAddress && poolId),
      refetchInterval: 5000,
    },
  });

  const { data: poolConfigRaw, refetch: refetchPoolConfig } = useReadContract({
    chainId: baseSepolia.id,
    address: auctionConfig.poolManagerAddress,
    abi: mockPoolManagerAbi,
    functionName: "pools",
    args: poolId ? [poolId] : undefined,
    query: {
      enabled: Boolean(auctionConfig.poolManagerAddress && poolId),
      refetchInterval: 7000,
    },
  });

  const { data: nextAuctionIdRaw, refetch: refetchNextAuctionId } = useReadContract({
    chainId: baseSepolia.id,
    address: auctionConfig.hookAddress,
    abi: stealthDutchAuctionHookAbi,
    functionName: "nextAuctionId",
    query: {
      enabled: Boolean(auctionConfig.hookAddress),
      refetchInterval: 7000,
    },
  });

  const poolAuction = poolAuctionRaw as PoolAuctionTuple | undefined;
  const poolConfig = poolConfigRaw as PoolConfigTuple | undefined;
  const poolRate = poolConfig?.[1] ?? 0n;
  const poolRateDenominator = poolConfig?.[2] ?? 0n;
  const poolExists = poolConfig?.[3] ?? false;
  const activeAuctionId = poolAuction?.[3] ?? 0n;
  const nextAuctionId = (nextAuctionIdRaw as bigint | undefined) ?? 0n;
  const monitorAuctionId = activeAuctionId > 0n ? activeAuctionId : nextAuctionId > 0n ? nextAuctionId : 0n;

  const { data: auctionStateRaw, refetch: refetchAuctionState } = useReadContract({
    chainId: baseSepolia.id,
    address: auctionConfig.hookAddress,
    abi: stealthDutchAuctionHookAbi,
    functionName: "getAuctionPlainState",
    args: [monitorAuctionId],
    query: {
      enabled: Boolean(auctionConfig.hookAddress && monitorAuctionId > 0n),
      refetchInterval: 5000,
    },
  });

  const auctionState = auctionStateRaw as AuctionPlainStateTuple | undefined;

  const auctionSeller = auctionState?.[0];
  const auctionIsActive = auctionState?.[1] ?? false;
  const auctionStartPrice = auctionState?.[2];
  const auctionEndPrice = auctionState?.[3];
  const auctionCurrentPrice = auctionState?.[4];
  const auctionSupply = auctionState?.[6];
  const auctionStartTime = auctionState?.[7];
  const auctionDuration = auctionState?.[8];

  const soldPercent = 0;

  const auctionEnd =
    auctionStartTime !== undefined && auctionDuration !== undefined ? auctionStartTime + auctionDuration : undefined;
  const remaining = auctionEnd !== undefined && auctionEnd > nowSec ? auctionEnd - nowSec : 0n;

  const { data: token0BalanceRaw, refetch: refetchToken0Balance } = useReadContract({
    chainId: baseSepolia.id,
    address: auctionConfig.token0Address,
    abi: mockFherc20Abi,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    query: {
      enabled: Boolean(connectedAddress && auctionConfig.token0Address),
      refetchInterval: 5000,
    },
  });

  const { data: paymentBalanceRaw, refetch: refetchPaymentBalance } = useReadContract({
    chainId: baseSepolia.id,
    address: auctionConfig.paymentTokenAddress,
    abi: mockFherc20Abi,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    query: {
      enabled: Boolean(connectedAddress && auctionConfig.paymentTokenAddress),
      refetchInterval: 5000,
    },
  });

  const { data: auctionBalanceRaw, refetch: refetchAuctionBalance } = useReadContract({
    chainId: baseSepolia.id,
    address: auctionConfig.auctionTokenAddress,
    abi: mockFherc20Abi,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    query: {
      enabled: Boolean(connectedAddress && auctionConfig.auctionTokenAddress),
      refetchInterval: 5000,
    },
  });

  const { data: token0AllowancePoolRaw, refetch: refetchToken0Allowance } = useReadContract({
    chainId: baseSepolia.id,
    address: auctionConfig.token0Address,
    abi: mockFherc20Abi,
    functionName: "allowance",
    args:
      connectedAddress && auctionConfig.poolManagerAddress
        ? [connectedAddress, auctionConfig.poolManagerAddress]
        : undefined,
    query: {
      enabled: Boolean(connectedAddress && auctionConfig.token0Address && auctionConfig.poolManagerAddress),
      refetchInterval: 7000,
    },
  });

  const { data: paymentAllowanceHookRaw, refetch: refetchPaymentAllowance } = useReadContract({
    chainId: baseSepolia.id,
    address: auctionConfig.paymentTokenAddress,
    abi: mockFherc20Abi,
    functionName: "allowance",
    args: connectedAddress && auctionConfig.hookAddress ? [connectedAddress, auctionConfig.hookAddress] : undefined,
    query: {
      enabled: Boolean(connectedAddress && auctionConfig.paymentTokenAddress && auctionConfig.hookAddress),
      refetchInterval: 7000,
    },
  });

  const { data: auctionAllowanceHookRaw, refetch: refetchAuctionAllowance } = useReadContract({
    chainId: baseSepolia.id,
    address: auctionConfig.auctionTokenAddress,
    abi: mockFherc20Abi,
    functionName: "allowance",
    args: connectedAddress && auctionConfig.hookAddress ? [connectedAddress, auctionConfig.hookAddress] : undefined,
    query: {
      enabled: Boolean(connectedAddress && auctionConfig.auctionTokenAddress && auctionConfig.hookAddress),
      refetchInterval: 7000,
    },
  });

  const { data: pendingPurchaseRaw, error: pendingPurchaseError, refetch: refetchPendingPurchase } = useReadContract({
    chainId: baseSepolia.id,
    address: auctionConfig.hookAddress,
    abi: stealthDutchAuctionHookAbi,
    functionName: "getPendingPurchase",
    args: connectedAddress && poolId ? [connectedAddress, poolId] : undefined,
    query: {
      enabled: Boolean(connectedAddress && poolId && auctionConfig.hookAddress),
      refetchInterval: 4000,
    },
  });

  const token0Balance = (token0BalanceRaw as bigint | undefined) ?? 0n;
  const paymentBalance = (paymentBalanceRaw as bigint | undefined) ?? 0n;
  const auctionBalance = (auctionBalanceRaw as bigint | undefined) ?? 0n;
  const token0AllowancePool = (token0AllowancePoolRaw as bigint | undefined) ?? 0n;
  const paymentAllowanceHook = (paymentAllowanceHookRaw as bigint | undefined) ?? 0n;
  const auctionAllowanceHook = (auctionAllowanceHookRaw as bigint | undefined) ?? 0n;
  const pendingPurchase = pendingPurchaseRaw as PendingPurchaseTuple | undefined;
  const pendingAuctionId = pendingPurchase?.auctionId ?? 0n;
  const pendingFillHandle = pendingPurchase?.encFinalFill ?? ZERO_HANDLE;
  const pendingPaymentHandle = pendingPurchase?.encFinalPayment ?? ZERO_HANDLE;
  const pendingFinalizeDeadline = pendingPurchase?.finalizeDeadline ?? 0n;
  const pendingReady = pendingPurchase?.ready ?? false;
  const pendingReadErrorText = pendingPurchaseError ? parseError(pendingPurchaseError) : undefined;
  const pendingFeatureUnsupported = Boolean(
    pendingReadErrorText &&
      /function|selector|revert|unknown|not found|does not exist/i.test(pendingReadErrorText.toLowerCase()),
  );
  const activePendingFromEvent =
    pendingFromEvent && pendingFromEvent.finalizeDeadline > nowSec ? pendingFromEvent : undefined;

  const contractPendingReady =
    pendingReady && pendingAuctionId > 0n && pendingPaymentHandle !== ZERO_HANDLE && pendingFillHandle !== ZERO_HANDLE;
  const effectivePendingAuctionId = contractPendingReady ? pendingAuctionId : (activePendingFromEvent?.auctionId ?? 0n);
  const effectivePendingFillHandle =
    contractPendingReady ? pendingFillHandle : (activePendingFromEvent?.fillHandle ?? ZERO_HANDLE);
  const effectivePendingPaymentHandle =
    contractPendingReady ? pendingPaymentHandle : (activePendingFromEvent?.paymentHandle ?? ZERO_HANDLE);
  const effectivePendingFinalizeDeadline =
    contractPendingReady ? pendingFinalizeDeadline : (activePendingFromEvent?.finalizeDeadline ?? 0n);
  const effectivePendingReady = contractPendingReady || Boolean(activePendingFromEvent);
  const effectivePendingSource = contractPendingReady ? "contract" : activePendingFromEvent ? "event" : "-";

  const { isLoading: txIsConfirming, isSuccess: txConfirmed, isError: txFailed, error: txError } =
    useWaitForTransactionReceipt({
      chainId: baseSepolia.id,
      hash: pendingTxHash,
      query: { enabled: Boolean(pendingTxHash) },
    });

  const refreshActivity = useCallback(async () => {
    if (!publicClient || !auctionConfig.hookAddress) {
      setActivity([]);
      setPendingFromEvent(undefined);
      return;
    }

    try {
      const latestBlock = blockNumber ?? (await publicClient.getBlockNumber());
      const fromBlock = latestBlock > EVENT_LOOKBACK_BLOCKS ? latestBlock - EVENT_LOOKBACK_BLOCKS : 0n;
      const logs: Awaited<ReturnType<typeof publicClient.getLogs>> = [];

      let chunkFrom = fromBlock;
      while (chunkFrom <= latestBlock) {
        const chunkTo = chunkFrom + MAX_LOG_QUERY_RANGE > latestBlock ? latestBlock : chunkFrom + MAX_LOG_QUERY_RANGE;
        const chunkLogs = await publicClient.getLogs({
          address: auctionConfig.hookAddress,
          fromBlock: chunkFrom,
          toBlock: chunkTo,
        });
        logs.push(...chunkLogs);

        if (chunkTo === latestBlock) break;
        chunkFrom = chunkTo + 1n;
      }

      const decodedLogs: Array<{
        decoded: { eventName: string; args: unknown };
        txHash: Hex;
        blockNumber: bigint;
        logIndex: bigint;
      }> = [];
      for (const log of logs) {
        try {
          if (!log.transactionHash) continue;
          const decoded = decodeEventLog({
            abi: stealthDutchAuctionHookAbi,
            data: log.data,
            topics: log.topics,
          }) as { eventName: string; args: unknown };
          decodedLogs.push({
            decoded,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber ?? 0n,
            logIndex: BigInt(log.logIndex ?? 0),
          });
        } catch {
          continue;
        }
      }

      const parsed = decodedLogs
        .map(item => toActivity(item.decoded, item.txHash, item.blockNumber, item.logIndex))
        .sort((a, b) => {
          if (a.blockNumber === b.blockNumber) return a.id < b.id ? 1 : -1;
          return a.blockNumber < b.blockNumber ? 1 : -1;
        });

      setActivity(parsed.slice(0, 25));

      if (!connectedAddress) {
        setPendingFromEvent(undefined);
      } else {
        const pendingByAuction = new Map<
          string,
          PendingFromEvent & {
            blockNumber: bigint;
            logIndex: bigint;
          }
        >();
        const asc = [...decodedLogs].sort((a, b) => {
          if (a.blockNumber === b.blockNumber) return a.logIndex < b.logIndex ? -1 : 1;
          return a.blockNumber < b.blockNumber ? -1 : 1;
        });

        for (const item of asc) {
          if (item.decoded.eventName === "AuctionSettlementReady") {
            const args = item.decoded.args as {
              auctionId: bigint;
              buyer: Address;
              paymentHandle: bigint;
              fillHandle: bigint;
              finalizeDeadline: bigint;
              direct: boolean;
            };
            if (!isSameAddress(args.buyer, connectedAddress)) continue;
            pendingByAuction.set(args.auctionId.toString(), {
              auctionId: args.auctionId,
              paymentHandle: (`0x${args.paymentHandle.toString(16).padStart(64, "0")}`) as Hex,
              fillHandle: (`0x${args.fillHandle.toString(16).padStart(64, "0")}`) as Hex,
              finalizeDeadline: args.finalizeDeadline,
              direct: args.direct,
              blockNumber: item.blockNumber,
              logIndex: item.logIndex,
            });
            continue;
          }

          if (item.decoded.eventName === "AuctionPurchase") {
            const args = item.decoded.args as { auctionId: bigint; buyer: Address };
            if (!isSameAddress(args.buyer, connectedAddress)) continue;
            pendingByAuction.delete(args.auctionId.toString());
          }
        }

        let latestPending:
          | (PendingFromEvent & {
              blockNumber: bigint;
              logIndex: bigint;
            })
          | undefined;
        for (const candidate of pendingByAuction.values()) {
          if (!latestPending) {
            latestPending = candidate;
            continue;
          }
          if (candidate.blockNumber > latestPending.blockNumber) {
            latestPending = candidate;
            continue;
          }
          if (candidate.blockNumber === latestPending.blockNumber && candidate.logIndex > latestPending.logIndex) {
            latestPending = candidate;
          }
        }

        if (!latestPending) {
          setPendingFromEvent(undefined);
        } else {
          setPendingFromEvent({
            auctionId: latestPending.auctionId,
            paymentHandle: latestPending.paymentHandle,
            fillHandle: latestPending.fillHandle,
            finalizeDeadline: latestPending.finalizeDeadline,
            direct: latestPending.direct,
          });
        }
      }
    } catch (err) {
      toast.error(parseError(err));
    }
  }, [publicClient, auctionConfig.hookAddress, blockNumber, connectedAddress]);

  const refreshContractReads = useCallback(async () => {
    await Promise.all([
      refetchPoolAuction(),
      refetchPoolConfig(),
      refetchNextAuctionId(),
      refetchAuctionState(),
      refetchToken0Balance(),
      refetchPaymentBalance(),
      refetchAuctionBalance(),
      refetchToken0Allowance(),
      refetchPaymentAllowance(),
      refetchAuctionAllowance(),
      refetchPendingPurchase(),
    ]);
  }, [
    refetchPoolAuction,
    refetchPoolConfig,
    refetchNextAuctionId,
    refetchAuctionState,
    refetchToken0Balance,
    refetchPaymentBalance,
    refetchAuctionBalance,
    refetchToken0Allowance,
    refetchPaymentAllowance,
    refetchAuctionAllowance,
    refetchPendingPurchase,
  ]);

  const refreshContractReadsBurst = useCallback(() => {
    void refreshContractReads();
    setTimeout(() => void refreshContractReads(), 1500);
    setTimeout(() => void refreshContractReads(), 5000);
  }, [refreshContractReads]);

  const runWrite = useCallback(
    async (label: string, action: () => Promise<Hex>) => {
      if (!connectedAddress) {
        toast.error("Connect a wallet first.");
        return;
      }

      try {
        const hash = await action();
        setPendingTxLabel(label);
        setPendingTxHash(hash);
        toast.success(`${label} submitted: ${shortHash(hash)}`);
      } catch (err) {
        toast.error(parseError(err));
      }
    },
    [connectedAddress],
  );

  const resolveProofsForIntent = useCallback(
    async (
      plainIntent: { desiredAuctionTokens: bigint; maxPricePerToken: bigint; minPaymentTokensFromSwap: bigint },
      verificationSender?: Address,
    ) => {
      const builder = getCofheHookDataBuilder();

      if (hookDataMode === "proofs") {
        const manualProofs = {
          desiredAuctionTokens: parseProofJson(desiredProof, "desiredAuctionTokens"),
        };

        const hasPlaceholder = isProofPlaceholder(manualProofs.desiredAuctionTokens);

        if (!hasPlaceholder) return manualProofs;

        if (verificationSender) {
          return deriveIntentProofsViaCofheSdk(
            {
              desiredAuctionTokens: plainIntent.desiredAuctionTokens.toString(),
              maxPricePerToken: plainIntent.maxPricePerToken.toString(),
              minPaymentTokensFromSwap: plainIntent.minPaymentTokensFromSwap.toString(),
            },
            verificationSender,
          );
        }

        if (!builder) {
          throw new Error(
            "Desired proof is placeholder (ctHash=0). Inject a cofhe hookData builder or provide a valid encrypted proof.",
          );
        }

        return deriveIntentProofsViaSdkBuilder(plainIntent, builder);
      }

      if (verificationSender) {
        return deriveIntentProofsViaCofheSdk(
          {
            desiredAuctionTokens: plainIntent.desiredAuctionTokens.toString(),
            maxPricePerToken: plainIntent.maxPricePerToken.toString(),
            minPaymentTokensFromSwap: plainIntent.minPaymentTokensFromSwap.toString(),
          },
          verificationSender,
        );
      }

      if (!builder) {
        return undefined;
      }

      return deriveIntentProofsViaSdkBuilder(plainIntent, builder);
    },
    [desiredProof, hookDataMode],
  );

  const verifyProofsForSender = useCallback(
    async (
      proofs: {
        desiredAuctionTokens: InEProof;
      },
      verificationSender: Address,
    ) => {
      if (!publicClient || !auctionConfig.hookAddress) {
        return;
      }

      const checks: Array<[string, InEProof]> = [["desiredAuctionTokens", proofs.desiredAuctionTokens]];

      for (const [label, proof] of checks) {
        try {
          await publicClient.readContract({
            address: TASK_MANAGER_ADDRESS,
            abi: taskManagerVerifyInputAbi,
            functionName: "verifyInput",
            args: [proof, verificationSender],
            account: auctionConfig.hookAddress as Address,
          });
        } catch {
          throw new Error(
            `[PROOF_SIGNER_MISMATCH] ${label} proof is invalid for sender ${verificationSender}. Rebuild proofs with cofhe encrypt account set to this sender.`,
          );
        }
      }
    },
    [publicClient],
  );

  useWatchContractEvent({
    chainId: baseSepolia.id,
    address: auctionConfig.hookAddress,
    abi: stealthDutchAuctionHookAbi,
    enabled: Boolean(auctionConfig.hookAddress),
    onLogs(logs) {
      const incoming: Array<{ eventName: string; activity: ActivityItem }> = [];
      for (const log of logs) {
        try {
          if (!log.transactionHash) continue;
          const decoded = decodeEventLog({
            abi: stealthDutchAuctionHookAbi,
            data: log.data,
            topics: log.topics,
          });
          incoming.push({
            eventName: decoded.eventName,
            activity: toActivity(decoded, log.transactionHash, log.blockNumber ?? 0n, BigInt(log.logIndex ?? 0)),
          });
        } catch {
          continue;
        }
      }

      if (incoming.length === 0) return;

      setActivity(prev => {
        const map = new Map<string, ActivityItem>();
        [...incoming.map(item => item.activity), ...prev].forEach(item => map.set(item.id, item));
        return [...map.values()]
          .sort((a, b) => {
            if (a.blockNumber === b.blockNumber) return a.id < b.id ? 1 : -1;
            return a.blockNumber < b.blockNumber ? 1 : -1;
          })
          .slice(0, 25);
      });

      void refreshActivity();
      const shouldRefreshReads = incoming.some(
        item =>
          item.eventName === "AuctionPurchase" ||
          item.eventName === "AuctionIntentRegistered" ||
          item.eventName === "PoolAuctionInitialized",
      );
      if (shouldRefreshReads) {
        refreshContractReadsBurst();
      }
    },
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setNowSec(BigInt(Math.floor(Date.now() / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    installCofheInjectionHelpersOnWindow();

    const syncBuilder = () => {
      const ready = tryAutoInjectCofheHookDataBuilderFromWindow();
      setCofheBuilderReady(ready || Boolean(getCofheHookDataBuilder()));
    };

    syncBuilder();
    const interval = setInterval(syncBuilder, 1500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const initCofhe = async () => {
      if (!publicClient || !walletClient || !connectedAddress || chain?.id !== baseSepolia.id) {
        return;
      }

      try {
        await initializeCofheSdkBuilder(publicClient, walletClient, {
          swapVerifierAccount: connectedAddress,
        });
        if (!cancelled) {
          setCofheInitError(undefined);
          setCofheBuilderReady(Boolean(getCofheHookDataBuilder()));
        }
      } catch (error) {
        if (!cancelled) {
          setCofheInitError(parseError(error));
        }
      }
    };

    void initCofhe();
    return () => {
      cancelled = true;
    };
  }, [publicClient, walletClient, connectedAddress, chain?.id]);

  useEffect(() => {
    let cancelled = false;

    const refreshSdkHealth = async () => {
      const client = createSdkClient();
      if (!client) {
        if (!cancelled) {
          setSdkHealth(undefined);
          setSdkHealthError("SDK client unavailable (missing config or wallet/public client).");
        }
        return;
      }

      try {
        const health = await client.healthcheck();
        if (!cancelled) {
          setSdkHealth(health);
          setSdkHealthError(undefined);
        }
      } catch (err) {
        if (!cancelled) {
          setSdkHealth(undefined);
          setSdkHealthError(parseError(err));
        }
      }
    };

    void refreshSdkHealth();
    const interval = setInterval(() => void refreshSdkHealth(), 12000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [createSdkClient]);

  useEffect(() => {
    void refreshActivity();
  }, [refreshActivity]);

  useEffect(() => {
    if (!txConfirmed || !pendingTxHash) return;
    toast.success(`${pendingTxLabel} confirmed`);
    setPendingTxHash(undefined);
    setPendingTxLabel("");
    refreshContractReadsBurst();
    void refreshActivity();
  }, [txConfirmed, pendingTxHash, pendingTxLabel, refreshContractReadsBurst, refreshActivity]);

  useEffect(() => {
    if (!txFailed || !pendingTxHash) return;
    toast.error(parseError(txError));
    setPendingTxHash(undefined);
    setPendingTxLabel("");
  }, [txFailed, txError, pendingTxHash]);

  const onStartAuction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!poolKey || !auctionConfig.hookAddress || !auctionConfig.auctionTokenAddress) {
      toast.error("Frontend config is incomplete.");
      return;
    }

    const seller = adminSeller.trim() || connectedAddress || "";
    if (!isAddress(seller)) {
      toast.error("Seller address is invalid.");
      return;
    }

    try {
      const startPrice = parseNumericInput(adminStartPrice, "Start price");
      const endPrice = parseNumericInput(adminEndPrice, "End price");
      const duration = parseNumericInput(adminDuration, "Duration");
      const supply = parseNumericInput(adminSupply, "Supply");

      if (startPrice < endPrice) {
        toast.error("Start price must be >= end price.");
        return;
      }

      await runWrite("Initialize auction", () =>
        writeContractAsync({
          chainId: baseSepolia.id,
          address: auctionConfig.hookAddress!,
          abi: stealthDutchAuctionHookAbi,
          functionName: "initializeAuctionPool",
          args: [poolKey, auctionConfig.auctionTokenAddress!, startPrice, endPrice, duration, supply, seller],
        }),
      );
    } catch (err) {
      toast.error(parseError(err));
    }
  };

  const relayFinalizePendingPurchase = useCallback(
    async (input: {
      buyer: Address;
      poolId: Hex;
      paymentProof: { value: bigint; signature: Hex };
      fillProof: { value: bigint; signature: Hex };
    }): Promise<Hex> => {
      const response = await fetch(relayerConfig.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          buyer: input.buyer,
          poolId: input.poolId,
          paymentProof: {
            value: input.paymentProof.value.toString(),
            signature: input.paymentProof.signature,
          },
          fillProof: {
            value: input.fillProof.value.toString(),
            signature: input.fillProof.signature,
          },
        }),
      });

      const payload = (await response.json()) as { ok?: boolean; txHash?: Hex; error?: string };
      if (!response.ok || !payload.ok || !payload.txHash || !isHex(payload.txHash)) {
        throw new Error(payload.error || `Relayer request failed with status ${response.status}`);
      }
      return payload.txHash;
    },
    [],
  );

  const awaitPendingSettlement = useCallback(
    async (buyer: Address, targetPoolId: Hex): Promise<PendingPurchaseTuple> => {
      if (!publicClient || !auctionConfig.hookAddress) {
        throw new Error("Public client is unavailable for pending settlement reads.");
      }

      for (let i = 0; i < 30; i += 1) {
        const pending = (await publicClient.readContract({
          address: auctionConfig.hookAddress,
          abi: stealthDutchAuctionHookAbi,
          functionName: "getPendingPurchase",
          args: [buyer, targetPoolId],
        })) as PendingPurchaseTuple;

        const ready = pending.ready;
        const fillHandle = pending.encFinalFill;
        const paymentHandle = pending.encFinalPayment;
        if (ready && fillHandle !== ZERO_HANDLE && paymentHandle !== ZERO_HANDLE) {
          return pending;
        }
        await sleep(1500);
      }

      throw new Error("Pending settlement did not become ready in time.");
    },
    [publicClient],
  );

  const submitStep1WithOptionalRelayerFinalize = useCallback(
    async (label: string, submit: () => Promise<Hex>) => {
      if (!connectedAddress) {
        toast.error("Connect a wallet first.");
        return;
      }

      const step1Hash = await submit();
      toast.success(`${label} submitted: ${shortHash(step1Hash)}`);

      if (!useRelayerFinalize) {
        setPendingTxLabel(label);
        setPendingTxHash(step1Hash);
        return;
      }

      if (!poolId || !publicClient || !walletClient) {
        setPendingTxLabel(label);
        setPendingTxHash(step1Hash);
        toast.error("Relayer auto-finalize unavailable; Step 1 submitted only.");
        return;
      }

      setRelayerBusy(true);

      try {
        await publicClient.waitForTransactionReceipt({
          hash: step1Hash,
          confirmations: 1,
          timeout: 120_000,
        });

        await refreshContractReads();
        await refreshActivity();

        const pending = await awaitPendingSettlement(connectedAddress, poolId);
        const fillHandle = pending.encFinalFill;
        const paymentHandle = pending.encFinalPayment;

        await initializeCofheSdkBuilder(publicClient, walletClient, { swapVerifierAccount: connectedAddress });
        const paymentProof = await decryptHandleForTxViaCofheSdk(BigInt(paymentHandle), connectedAddress);
        const fillProof = await decryptHandleForTxViaCofheSdk(BigInt(fillHandle), connectedAddress);

        const relayHash = await relayFinalizePendingPurchase({
          buyer: connectedAddress,
          poolId,
          paymentProof: {
            value: paymentProof.decryptedValue,
            signature: paymentProof.signature,
          },
          fillProof: {
            value: fillProof.decryptedValue,
            signature: fillProof.signature,
          },
        });

        setPendingTxLabel("Relayer finalize pending purchase");
        setPendingTxHash(relayHash);
        toast.success(`Relayer finalize submitted: ${shortHash(relayHash)}`);
      } finally {
        setRelayerBusy(false);
      }
    },
    [
      awaitPendingSettlement,
      connectedAddress,
      poolId,
      publicClient,
      walletClient,
      refreshContractReads,
      refreshActivity,
      relayFinalizePendingPurchase,
      useRelayerFinalize,
    ],
  );

  const onSwapAndBuy = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!poolKey || !auctionConfig.poolManagerAddress) {
      toast.error("Frontend config is incomplete.");
      return;
    }

    try {
      const amountIn = parseNumericInput(swapInput, "Swap input");
      if (amountIn <= 0n) {
        toast.error("Swap input must be > 0.");
        return;
      }

      const plainIntent = {
        desiredAuctionTokens: parseNumericInput(desiredTokens, "Desired auction tokens"),
        maxPricePerToken: parseNumericInput(maxPrice, "Max price per token"),
        minPaymentTokensFromSwap: parseNumericInput(minPaymentOut, "Min payment tokens from swap"),
      };
      if (plainIntent.desiredAuctionTokens <= 0n || plainIntent.maxPricePerToken <= 0n) {
        toast.error("Desired auction tokens and max price per token must be > 0.");
        return;
      }

      if (auctionCurrentPrice !== undefined && plainIntent.maxPricePerToken < auctionCurrentPrice) {
        toast.error(
          `Max price per token (${formatInt(plainIntent.maxPricePerToken)}) is below current auction price (${formatInt(auctionCurrentPrice)}).`,
        );
        return;
      }

      if (poolExists && poolRateDenominator > 0n && poolRate > 0n) {
        const expectedPaymentFromSwap = (amountIn * poolRate) / poolRateDenominator;
        if (expectedPaymentFromSwap < plainIntent.minPaymentTokensFromSwap) {
          toast.error(
            `Min payment from swap (${formatInt(plainIntent.minPaymentTokensFromSwap)}) exceeds expected swap output (${formatInt(expectedPaymentFromSwap)}).`,
          );
          return;
        }

        if (auctionCurrentPrice !== undefined) {
          const requiredPayment = plainIntent.desiredAuctionTokens * auctionCurrentPrice;
          if (expectedPaymentFromSwap < requiredPayment) {
            const maxAffordableTokens = auctionCurrentPrice > 0n ? expectedPaymentFromSwap / auctionCurrentPrice : 0n;
            toast.error(
              `Swap input is too low. Expected payment output is ${formatInt(expectedPaymentFromSwap)}, but ${formatInt(
                plainIntent.desiredAuctionTokens,
              )} tokens need ${formatInt(requiredPayment)} at current price. Max affordable desired tokens: ${formatInt(
                maxAffordableTokens,
              )}.`,
            );
            return;
          }
        }
      }

      if (!connectedAddress) {
        toast.error("Connect a wallet first.");
        return;
      }

      const swapVerificationSender = connectedAddress;
      const proofs = await resolveProofsForIntent(plainIntent, swapVerificationSender);
      if (proofs && swapVerificationSender) {
        await verifyProofsForSender(proofs, swapVerificationSender);
      }

      await buildHookData({
        mode: hookDataMode,
        plainIntent,
        cofheBuildAuctionIntentHookData: hookDataMode === "sdk" ? getCofheHookDataBuilder() : undefined,
        proofs,
      });

      const sdkClient = createSdkClient();
      if (!sdkClient || !poolId) {
        toast.error("SDK client unavailable.");
        return;
      }

      await submitStep1WithOptionalRelayerFinalize("Step 1: Swap + register intent", () =>
        sdkClient.auction.swapAndBuy({
          poolId,
          swapInput: amountIn,
          intent: plainIntent,
          mode: hookDataMode,
          proofs,
        }),
      );
    } catch (err) {
      toast.error(parseError(err));
    }
  };

  const onDirectBuyWithPaymentToken = async () => {
    if (!poolId || !auctionConfig.hookAddress) {
      toast.error("Frontend config is incomplete.");
      return;
    }
    if (!connectedAddress) {
      toast.error("Connect a wallet first.");
      return;
    }

    try {
      const desiredAuctionTokens = parseNumericInput(desiredTokens, "Desired auction tokens");
      const maxPricePerToken = parseNumericInput(maxPrice, "Max price per token");
      const minPaymentTokensFromSwap = parseNumericInput(minPaymentOut, "Min payment tokens from swap");
      if (desiredAuctionTokens <= 0n || maxPricePerToken <= 0n) {
        toast.error("Desired amount and max price must be > 0.");
        return;
      }
      if (auctionCurrentPrice !== undefined && maxPricePerToken < auctionCurrentPrice) {
        toast.error(
          `Max price per token (${formatInt(maxPricePerToken)}) is below current auction price (${formatInt(auctionCurrentPrice)}).`,
        );
        return;
      }

      const intent = {
        desiredAuctionTokens,
        maxPricePerToken,
        minPaymentTokensFromSwap,
      };
      const proofs = await resolveProofsForIntent(intent, connectedAddress);
      if (!proofs) {
        toast.error("No proof helper available. Inject cofhe builder or provide non-placeholder encrypted proofs.");
        return;
      }
      await verifyProofsForSender(proofs, connectedAddress);

      await submitStep1WithOptionalRelayerFinalize("Step 1: Direct buy + register intent", () =>
        writeContractAsync({
          chainId: baseSepolia.id,
          address: auctionConfig.hookAddress!,
          abi: stealthDutchAuctionHookAbi,
          functionName: "buyWithPaymentTokenEncrypted",
          args: [poolId, proofs.desiredAuctionTokens, maxPricePerToken],
        }),
      );
    } catch (err) {
      toast.error(parseError(err));
    }
  };

  const onFinalizePendingPurchase = async () => {
    if (!connectedAddress) {
      toast.error("Connect a wallet first.");
      return;
    }
    if (!poolId) {
      toast.error("Pool is not configured.");
      return;
    }
    if (pendingFeatureUnsupported) {
      toast.error(
        "Current hook deployment does not expose pending-settlement reads. Redeploy latest 2-step hook and update frontend env.",
      );
      return;
    }
    if (!effectivePendingReady || effectivePendingAuctionId === 0n) {
      toast.error("No ready pending purchase for this wallet.");
      return;
    }
    if (effectivePendingPaymentHandle === ZERO_HANDLE || effectivePendingFillHandle === ZERO_HANDLE) {
      toast.error("Pending settlement handles are missing.");
      return;
    }
    if (!publicClient || !walletClient) {
      toast.error("Wallet client unavailable.");
      return;
    }

    try {
      await initializeCofheSdkBuilder(publicClient, walletClient, { swapVerifierAccount: connectedAddress });

      const paymentProof = await decryptHandleForTxViaCofheSdk(BigInt(effectivePendingPaymentHandle), connectedAddress);
      const fillProof = await decryptHandleForTxViaCofheSdk(BigInt(effectivePendingFillHandle), connectedAddress);

      const sdkClient = createSdkClient();
      if (!sdkClient) {
        toast.error("SDK client unavailable.");
        return;
      }

      await runWrite("Finalize pending purchase", () =>
        sdkClient.auction.finalizePendingPurchase({
          poolId,
          paymentProof: {
            value: paymentProof.decryptedValue,
            signature: paymentProof.signature,
          },
          fillProof: {
            value: fillProof.decryptedValue,
            signature: fillProof.signature,
          },
        }),
      );
    } catch (err) {
      toast.error(parseError(err));
    }
  };

  const wrongNetwork = chain?.id !== undefined && chain.id !== baseSepolia.id;

  return (
    <div className="relative isolate overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-[-8rem] top-[-10rem] h-80 w-80 rounded-full bg-[#ffb35c]/30 blur-3xl" />
        <div className="absolute bottom-[-8rem] right-[-8rem] h-96 w-96 rounded-full bg-[#00b3a4]/20 blur-3xl" />
      </div>

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 lg:px-8 lg:py-10">
        <section className="rounded-3xl border border-base-300 bg-base-100/90 p-6 shadow-xl shadow-base-300/40 lg:p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="m-0 text-xs uppercase tracking-[0.18em] text-base-content/60">Base Sepolia Deployment</p>
              <h1 className="m-0 text-3xl font-semibold tracking-tight">Stealth Dutch Auction Interface</h1>
              <p className="mb-0 mt-2 text-sm text-base-content/70">
                Step 1 registers encrypted intent on swap. Step 2 finalizes settlement with decrypt-for-tx proofs.
              </p>
            </div>
            <div className="grid gap-2 text-xs text-base-content/80">
              <span>
                Pool ID: <code className="font-semibold">{poolId ? shortHash(poolId) : "-"}</code>
              </span>
              <span>
                Hook: <code className="font-semibold">{shortAddress(auctionConfig.hookAddress)}</code>
              </span>
            </div>
          </div>
        </section>

        {!isAuctionConfigReady && (
          <section className="rounded-2xl border border-warning/40 bg-warning/10 p-4">
            <p className="m-0 text-sm font-medium">
              Missing frontend config. Set these env vars in `frontend/.env.local`:
            </p>
            <p className="mb-0 mt-2 break-all text-xs text-base-content/80">{requiredEnvKeys.join(", ")}</p>
          </section>
        )}

        {wrongNetwork && (
          <section className="rounded-2xl border border-error/40 bg-error/10 p-4 text-sm">
            Wallet is connected to chain `{chain?.id}`. Switch to Base Sepolia (84532).
          </section>
        )}

        <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
          <section className="rounded-3xl border border-base-300 bg-base-100 p-6 shadow-xl shadow-base-300/40">
            <div className="flex items-center justify-between gap-4">
              <h2 className="m-0 text-xl font-semibold">Auction Monitor</h2>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  auctionIsActive ? "bg-emerald-500/20 text-emerald-700" : "bg-base-300 text-base-content/70"
                }`}
              >
                {auctionIsActive ? "Active" : "Inactive"}
              </span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-base-300 bg-base-200/60 p-4">
                <p className="m-0 text-xs uppercase tracking-[0.12em] text-base-content/60">Active Auction ID</p>
                <p className="mb-0 mt-2 text-lg font-semibold">{formatInt(activeAuctionId)}</p>
              </div>
              <div className="rounded-2xl border border-base-300 bg-base-200/60 p-4">
                <p className="m-0 text-xs uppercase tracking-[0.12em] text-base-content/60">Current Price</p>
                <p className="mb-0 mt-2 text-lg font-semibold">{formatInt(auctionCurrentPrice)}</p>
              </div>
              <div className="rounded-2xl border border-base-300 bg-base-200/60 p-4">
                <p className="m-0 text-xs uppercase tracking-[0.12em] text-base-content/60">Sold / Supply</p>
                <p className="mb-0 mt-2 text-lg font-semibold">
                  Encrypted / {formatInt(auctionSupply)}
                </p>
              </div>
              <div className="rounded-2xl border border-base-300 bg-base-200/60 p-4">
                <p className="m-0 text-xs uppercase tracking-[0.12em] text-base-content/60">Time Remaining</p>
                <p className="mb-0 mt-2 text-lg font-semibold">{formatTimeRemaining(remaining)}</p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-base-300 bg-base-200/30 p-4">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span>Allocation Progress</span>
                <span className="font-semibold">Encrypted</span>
              </div>
              <progress className="progress progress-primary h-3 w-full" value={soldPercent} max={100} />
            </div>

            <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-xl border border-base-300 p-3">
                <p className="m-0 text-xs uppercase tracking-[0.1em] text-base-content/60">Seller</p>
                <p className="mb-0 mt-1 font-medium">{shortAddress(auctionSeller)}</p>
              </div>
              <div className="rounded-xl border border-base-300 p-3">
                <p className="m-0 text-xs uppercase tracking-[0.1em] text-base-content/60">Price Range</p>
                <p className="mb-0 mt-1 font-medium">
                  {formatInt(auctionStartPrice)} → {formatInt(auctionEndPrice)}
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-base-300 bg-base-100 p-6 shadow-xl shadow-base-300/40">
            <h2 className="m-0 text-xl font-semibold">Wallet Snapshot</h2>

            <div className="mt-4 space-y-3 text-sm">
              <div className="rounded-xl border border-base-300 p-3">
                <p className="m-0 text-xs uppercase tracking-[0.1em] text-base-content/60">Connected</p>
                <p className="mb-0 mt-1 font-medium">{shortAddress(connectedAddress)}</p>
              </div>

              <div className="rounded-xl border border-base-300 p-3">
                <p className="m-0 text-xs uppercase tracking-[0.1em] text-base-content/60">Token Balances</p>
                <p className="m-0 mt-1">Token0: {formatInt(token0Balance)}</p>
                <p className="m-0">Payment: {formatInt(paymentBalance)}</p>
                <p className="m-0">Auction: {formatInt(auctionBalance)}</p>
              </div>

              <div className="rounded-xl border border-base-300 p-3">
                <p className="m-0 text-xs uppercase tracking-[0.1em] text-base-content/60">Allowances</p>
                <p className="m-0 mt-1">Token0 → PoolManager: {formatInt(token0AllowancePool)}</p>
                <p className="m-0">Payment → Hook: {formatInt(paymentAllowanceHook)}</p>
                <p className="m-0">Auction → Hook: {formatInt(auctionAllowanceHook)}</p>
              </div>

              <div className="rounded-xl border border-base-300 p-3">
                <p className="m-0 text-xs uppercase tracking-[0.1em] text-base-content/60">SDK Healthcheck</p>
                {sdkHealth ? (
                  <>
                    <p className="m-0 mt-1">RPC: {sdkHealth.rpc ? "ok" : "down"}</p>
                    <p className="m-0">Hook Reachable: {sdkHealth.contractReachability.hook ? "yes" : "no"}</p>
                    <p className="m-0">HookData Builder: {cofheBuilderReady ? "yes" : "no"}</p>
                    <p className="m-0">Decrypt View: {sdkHealth.decryptForView ? "yes" : "no"}</p>
                    <p className="m-0">Decrypt Tx: {sdkHealth.decryptForTx ? "yes" : "no"}</p>
                    {cofheInitError && <p className="m-0 text-xs text-error">Cofhe init: {cofheInitError}</p>}
                  </>
                ) : (
                  <p className="m-0 mt-1 text-xs text-base-content/70">{sdkHealthError ?? "Checking..."}</p>
                )}
              </div>
            </div>

            <div className="mt-5 space-y-2">
              <button
                className="btn btn-primary btn-sm w-full"
                type="button"
                onClick={() =>
                  void runWrite("Approve token0 for swaps", () =>
                    writeContractAsync({
                      chainId: baseSepolia.id,
                      address: auctionConfig.token0Address!,
                      abi: mockFherc20Abi,
                      functionName: "approve",
                      args: [auctionConfig.poolManagerAddress!, MAX_UINT256],
                    }),
                  )
                }
                disabled={!connectedAddress || !isAuctionConfigReady || txIsConfirming}
              >
                Approve Token0 → PoolManager
              </button>

              <button
                className="btn btn-primary btn-sm w-full"
                type="button"
                onClick={() =>
                  void runWrite("Approve payment token for hook", () =>
                    writeContractAsync({
                      chainId: baseSepolia.id,
                      address: auctionConfig.paymentTokenAddress!,
                      abi: mockFherc20Abi,
                      functionName: "approve",
                      args: [auctionConfig.hookAddress!, MAX_UINT256],
                    }),
                  )
                }
                disabled={!connectedAddress || !isAuctionConfigReady || txIsConfirming}
              >
                Approve Payment → Hook
              </button>

              <button
                className="btn btn-secondary btn-sm w-full"
                type="button"
                onClick={() =>
                  void runWrite("Approve auction token for hook", () =>
                    writeContractAsync({
                      chainId: baseSepolia.id,
                      address: auctionConfig.auctionTokenAddress!,
                      abi: mockFherc20Abi,
                      functionName: "approve",
                      args: [auctionConfig.hookAddress!, MAX_UINT256],
                    }),
                  )
                }
                disabled={!connectedAddress || !isAuctionConfigReady || txIsConfirming}
              >
                Approve Auction → Hook
              </button>
            </div>
          </section>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-3xl border border-base-300 bg-base-100 p-6 shadow-xl shadow-base-300/40">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="m-0 text-xl font-semibold">Seller/Admin</h2>
              <span className="rounded-full bg-base-200 px-3 py-1 text-xs">Owner-only initialization</span>
            </div>

            <form className="grid gap-3" onSubmit={onStartAuction}>
              <label className="form-control gap-1">
                <span className="label-text text-sm">Start Price</span>
                <input
                  className="input input-bordered"
                  value={adminStartPrice}
                  onChange={event => setAdminStartPrice(event.target.value)}
                />
              </label>

              <label className="form-control gap-1">
                <span className="label-text text-sm">End Price</span>
                <input
                  className="input input-bordered"
                  value={adminEndPrice}
                  onChange={event => setAdminEndPrice(event.target.value)}
                />
              </label>

              <label className="form-control gap-1">
                <span className="label-text text-sm">Duration (seconds)</span>
                <input
                  className="input input-bordered"
                  value={adminDuration}
                  onChange={event => setAdminDuration(event.target.value)}
                />
              </label>

              <label className="form-control gap-1">
                <span className="label-text text-sm">Supply</span>
                <input
                  className="input input-bordered"
                  value={adminSupply}
                  onChange={event => setAdminSupply(event.target.value)}
                />
              </label>

              <label className="form-control gap-1">
                <span className="label-text text-sm">Seller Address</span>
                <input
                  className="input input-bordered"
                  placeholder="Defaults to connected wallet"
                  value={adminSeller}
                  onChange={event => setAdminSeller(event.target.value)}
                />
              </label>

              <button className="btn btn-accent mt-2" type="submit" disabled={txIsConfirming || !isAuctionConfigReady}>
                Start New Auction
              </button>
            </form>

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <label className="form-control gap-1">
                <span className="label-text text-sm">Mint Token0 (demo)</span>
                <input
                  className="input input-bordered"
                  value={mintToken0Amount}
                  onChange={event => setMintToken0Amount(event.target.value)}
                />
              </label>

              <label className="form-control gap-1">
                <span className="label-text text-sm">Mint Auction Token (demo)</span>
                <input
                  className="input input-bordered"
                  value={mintAuctionAmount}
                  onChange={event => setMintAuctionAmount(event.target.value)}
                />
              </label>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button
                className="btn btn-outline btn-sm"
                type="button"
                onClick={() =>
                  void runWrite("Mint token0", () =>
                    writeContractAsync({
                      chainId: baseSepolia.id,
                      address: auctionConfig.token0Address!,
                      abi: mockFherc20Abi,
                      functionName: "mint",
                      args: [connectedAddress!, parseNumericInput(mintToken0Amount, "Mint token0 amount")],
                    }),
                  )
                }
                disabled={!connectedAddress || !auctionConfig.token0Address || txIsConfirming}
              >
                Mint Token0 to Me
              </button>

              <button
                className="btn btn-outline btn-sm"
                type="button"
                onClick={() =>
                  void runWrite("Mint auction token", () =>
                    writeContractAsync({
                      chainId: baseSepolia.id,
                      address: auctionConfig.auctionTokenAddress!,
                      abi: mockFherc20Abi,
                      functionName: "mint",
                      args: [connectedAddress!, parseNumericInput(mintAuctionAmount, "Mint auction amount")],
                    }),
                  )
                }
                disabled={!connectedAddress || !auctionConfig.auctionTokenAddress || txIsConfirming}
              >
                Mint Auction Token to Me
              </button>
            </div>
          </section>

          <section className="rounded-3xl border border-base-300 bg-base-100 p-6 shadow-xl shadow-base-300/40">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="m-0 text-xl font-semibold">Buyer Swap + Auction Intent</h2>
              <span className="rounded-full bg-base-200 px-3 py-1 text-xs">Two-step settlement flow</span>
            </div>

            <form className="grid gap-3" onSubmit={onSwapAndBuy}>
              <label className="form-control gap-1">
                <span className="label-text text-sm">Swap Input (token0 units)</span>
                <input className="input input-bordered" value={swapInput} onChange={event => setSwapInput(event.target.value)} />
              </label>

              <label className="form-control gap-1">
                <span className="label-text text-sm">Desired Auction Tokens</span>
                <input
                  className="input input-bordered"
                  value={desiredTokens}
                  onChange={event => setDesiredTokens(event.target.value)}
                />
              </label>

              <label className="form-control gap-1">
                <span className="label-text text-sm">Max Price Per Token</span>
                <input className="input input-bordered" value={maxPrice} onChange={event => setMaxPrice(event.target.value)} />
              </label>

              <label className="form-control gap-1">
                <span className="label-text text-sm">Min Payment Tokens From Swap</span>
                <input
                  className="input input-bordered"
                  value={minPaymentOut}
                  onChange={event => setMinPaymentOut(event.target.value)}
                />
              </label>

              <label className="form-control gap-1">
                <span className="label-text text-sm">hookData Mode (supports euint/ebool variants)</span>
                <select
                  className="select select-bordered"
                  value={hookDataMode}
                  onChange={event => setHookDataMode(event.target.value as HookDataMode)}
                >
                  <option value="proofs">InE proof tuple (encrypted)</option>
                  <option value="sdk">SDK auto payload (injected builder)</option>
                </select>
              </label>

              {hookDataMode === "proofs" && (
                <div className="rounded-2xl border border-base-300 bg-base-200/30 p-3">
                  <p className="m-0 text-xs text-base-content/70">
                    JSON fields required: ctHash, securityZone, utype, signature for `desiredAuctionTokens` only. If
                    ctHash is 0 and a cofhe builder is injected, a valid proof is auto-derived from numeric inputs.
                  </p>
                  <div className="mt-2 grid gap-2">
                    <textarea
                      className="textarea textarea-bordered h-20"
                      value={desiredProof}
                      onChange={event => setDesiredProof(event.target.value)}
                    />
                  </div>
                </div>
              )}

              {hookDataMode === "sdk" && (
                <div className="rounded-2xl border border-info/40 bg-info/10 p-3 text-xs">
                  Inject a cofhe SDK hookData builder via `injectCofheHookDataBuilder(...)`. This also powers proof
                  auto-derivation for direct buy.
                </div>
              )}

              <button
                className="btn btn-primary mt-2"
                type="submit"
                disabled={txIsConfirming || relayerBusy || !isAuctionConfigReady}
              >
                Step 1: Execute Swap + Register Intent
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => void onDirectBuyWithPaymentToken()}
                disabled={txIsConfirming || relayerBusy || !isAuctionConfigReady || !auctionIsActive}
              >
                Step 1: Direct Buy + Register Intent
              </button>
              <div className="mt-2 rounded-2xl border border-base-300 bg-base-200/30 p-3 text-xs">
                <p className="m-0 font-semibold">Manual finalize mode (v1)</p>
                <p className="m-0 mt-1">
                  Step 2 remains visible and must be executed manually after pending settlement becomes ready.
                </p>
              </div>
              <div className="mt-2 rounded-2xl border border-base-300 bg-base-200/30 p-3 text-xs">
                <p className="m-0 font-semibold">Pending Settlement</p>
                <p className="m-0 mt-1">Source: {effectivePendingSource}</p>
                <p className="m-0">Auction: {formatInt(effectivePendingAuctionId)}</p>
                <p className="m-0">Ready: {effectivePendingReady ? "yes" : "no"}</p>
                <p className="m-0">Fill Handle: {shortHash(effectivePendingFillHandle)}</p>
                <p className="m-0">Payment Handle: {shortHash(effectivePendingPaymentHandle)}</p>
                <p className="m-0">
                  Finalize Deadline: {effectivePendingFinalizeDeadline > 0n ? effectivePendingFinalizeDeadline.toString() : "-"}
                </p>
                {pendingReadErrorText && (
                  <p className="m-0 mt-1 text-warning">Pending read error: {pendingReadErrorText}</p>
                )}
                {pendingFeatureUnsupported && (
                  <p className="m-0 mt-1 text-warning">
                    This deployment is missing 2-step pending APIs. Step 2 will remain disabled until you redeploy latest hook.
                  </p>
                )}
              </div>
              <button
                className="btn btn-accent"
                type="button"
                onClick={() => void onFinalizePendingPurchase()}
                disabled={
                  txIsConfirming ||
                  relayerBusy ||
                  !isAuctionConfigReady ||
                  pendingFeatureUnsupported ||
                  !effectivePendingReady ||
                  effectivePendingAuctionId === 0n ||
                  effectivePendingPaymentHandle === ZERO_HANDLE ||
                  effectivePendingFillHandle === ZERO_HANDLE
                }
              >
                Step 2: Finalize Pending Purchase
              </button>
            </form>
          </section>
        </div>

        <section className="rounded-3xl border border-base-300 bg-base-100 p-6 shadow-xl shadow-base-300/40">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="m-0 text-xl font-semibold">Activity</h2>
            <button className="btn btn-ghost btn-xs" type="button" onClick={() => void refreshActivity()}>
              Refresh
            </button>
          </div>

          {activity.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-base-300 p-6 text-sm text-base-content/70">
              No auction activity detected yet.
            </div>
          ) : (
            <div className="space-y-2">
              {activity.map(item => (
                <article key={item.id} className="rounded-2xl border border-base-300 bg-base-200/30 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="m-0 font-medium">{item.title}</p>
                    <span className="text-xs text-base-content/70">Block {item.blockNumber.toString()}</span>
                  </div>
                  <p className="mb-0 mt-1 text-sm text-base-content/80">{item.detail}</p>
                  <p className="mb-0 mt-1 text-xs text-base-content/60">Tx: {shortHash(item.txHash)}</p>
                </article>
              ))}
            </div>
          )}
        </section>

        {(pendingTxHash || txIsConfirming) && (
          <section className="rounded-2xl border border-primary/40 bg-primary/10 p-3 text-sm">
            {txIsConfirming ? "Confirming" : "Submitted"}: {pendingTxLabel} {shortHash(pendingTxHash)}
          </section>
        )}
      </div>
    </div>
  );
};

export default Home;
