import { Encryptable, type EncryptedItemInput } from "@cofhe/sdk";
import { chains } from "@cofhe/sdk/chains";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/web";
import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { injectCofheHookDataBuilder } from "~~/lib/auction/cofheAdapter";
import { encodeIntentProofs } from "~~/lib/auction/encoding";

type HookDataIntent = {
  desiredAuctionTokens: string;
  maxPricePerToken: string;
  minPaymentTokensFromSwap: string;
};

type IntentProofTuple = {
  desiredAuctionTokens: {
    ctHash: bigint;
    securityZone: number;
    utype: number;
    signature: Hex;
  };
};

type CofheClientLike = {
  connect: (publicClient: PublicClient, walletClient: WalletClient) => Promise<void>;
  encryptInputs: (inputs: ReturnType<typeof Encryptable.uint128>[]) => {
    setAccount: (account: Address) => unknown;
    execute: () => Promise<EncryptedItemInput[]>;
  };
  decryptForTx: (ctHash: bigint | string) => {
    setChainId: (chainId: number) => unknown;
    setAccount: (account: Address) => unknown;
    withoutPermit: () => {
      execute: () => Promise<{
        ctHash: bigint | string;
        decryptedValue: bigint;
        signature: Hex;
      }>;
    };
  };
};

let cofheClient: CofheClientLike | undefined;
let connectPromise: Promise<void> | undefined;
let swapVerifierAccount: Address | undefined;

const toUint128 = (value: string, label: string): bigint => {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error(`${label} must be >= 0`);
    if (parsed > (1n << 128n) - 1n) throw new Error(`${label} must fit uint128`);
    return parsed;
  } catch (error) {
    throw new Error(`Invalid ${label}: ${(error as Error).message}`);
  }
};

const normalizeEncryptedItem = (item: EncryptedItemInput, label: string) => {
  if (item.ctHash <= 0n) {
    throw new Error(`${label}.ctHash must be > 0`);
  }
  if (item.securityZone < 0 || item.securityZone > 255) {
    throw new Error(`${label}.securityZone must be uint8`);
  }
  if (item.utype < 0 || item.utype > 255) {
    throw new Error(`${label}.utype must be uint8`);
  }

  return {
    ctHash: item.ctHash,
    securityZone: item.securityZone,
    utype: item.utype,
    signature: item.signature as Hex,
  };
};

const encryptAuctionIntent = async (intent: HookDataIntent, verifierAccount?: Address): Promise<IntentProofTuple> => {
  if (!cofheClient) {
    throw new Error("Cofhe SDK client is not initialized.");
  }

  const builder = cofheClient.encryptInputs([
    Encryptable.uint128(toUint128(intent.desiredAuctionTokens, "desiredAuctionTokens")),
  ]);

  if (verifierAccount) {
    builder.setAccount(verifierAccount);
  }

  const encrypted = await builder.execute();

  if (!Array.isArray(encrypted) || encrypted.length !== 1) {
    throw new Error("Cofhe SDK encryption output is invalid for auction intent.");
  }

  return {
    desiredAuctionTokens: normalizeEncryptedItem(encrypted[0], "desiredAuctionTokens"),
  };
};

export const deriveIntentProofsViaCofheSdk = async (
  intent: HookDataIntent,
  verifierAccount?: Address,
): Promise<IntentProofTuple> => {
  return encryptAuctionIntent(intent, verifierAccount);
};

export const decryptHandleForTxViaCofheSdk = async (
  ctHash: bigint | string,
  account?: Address,
): Promise<{ decryptedValue: bigint; signature: Hex }> => {
  if (!cofheClient) {
    throw new Error("Cofhe SDK client is not initialized.");
  }

  const builder = cofheClient.decryptForTx(ctHash);
  builder.setChainId(chains.baseSepolia.id);
  if (account) {
    builder.setAccount(account);
  }

  const result = await builder.withoutPermit().execute();
  return {
    decryptedValue: result.decryptedValue,
    signature: result.signature,
  };
};

const buildAuctionIntentHookData = async (intent: HookDataIntent): Promise<Hex> => {
  const proofs = await encryptAuctionIntent(intent, swapVerifierAccount);
  return encodeIntentProofs(proofs, {
    desiredAuctionTokens: toUint128(intent.desiredAuctionTokens, "desiredAuctionTokens"),
    maxPricePerToken: toUint128(intent.maxPricePerToken, "maxPricePerToken"),
    minPaymentTokensFromSwap: toUint128(intent.minPaymentTokensFromSwap, "minPaymentTokensFromSwap"),
  });
};

const ensureClient = (): CofheClientLike => {
  if (!cofheClient) {
    const config = createCofheConfig({
      supportedChains: [chains.baseSepolia, chains.sepolia],
    });
    cofheClient = createCofheClient(config) as unknown as CofheClientLike;

    injectCofheHookDataBuilder(buildAuctionIntentHookData);
  }
  return cofheClient;
};

export const initializeCofheSdkBuilder = async (
  publicClient: PublicClient,
  walletClient: WalletClient,
  options?: {
    swapVerifierAccount?: Address;
  },
): Promise<void> => {
  swapVerifierAccount = options?.swapVerifierAccount;
  const client = ensureClient();
  if (!connectPromise) {
    connectPromise = client.connect(publicClient, walletClient).finally(() => {
      connectPromise = undefined;
    });
  }
  await connectPromise;
};
