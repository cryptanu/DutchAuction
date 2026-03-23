import { AuctionClientError } from "./errors.js";
import type { Address, AuctionAddresses } from "./types.js";
import { isAddress } from "./utils.js";

export const AUCTION_ENV_SCHEMA = {
  NEXT_PUBLIC_HOOK_ADDRESS: "StealthDutchAuctionHook contract address",
  NEXT_PUBLIC_POOL_MANAGER_ADDRESS: "PoolManager contract address",
  NEXT_PUBLIC_TOKEN0_ADDRESS: "Token0 (swap input token) contract address",
  NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS: "Encrypted payment token contract address",
  NEXT_PUBLIC_AUCTION_TOKEN_ADDRESS: "Auction token contract address",
  NEXT_PUBLIC_POOL_FEE: "Pool fee in hundredths of a bip (default: 3000)",
  NEXT_PUBLIC_POOL_TICK_SPACING: "Pool tick spacing (default: 60)",
} as const;

export type AuctionEnv = {
  NEXT_PUBLIC_HOOK_ADDRESS?: string;
  NEXT_PUBLIC_POOL_MANAGER_ADDRESS?: string;
  NEXT_PUBLIC_TOKEN0_ADDRESS?: string;
  NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS?: string;
  NEXT_PUBLIC_AUCTION_TOKEN_ADDRESS?: string;
  NEXT_PUBLIC_POOL_FEE?: string;
  NEXT_PUBLIC_POOL_TICK_SPACING?: string;
};

const parseAddress = (value: string | undefined, label: keyof AuctionEnv): Address => {
  if (!value || !isAddress(value)) {
    throw new AuctionClientError("INVALID_CONFIG", `${label} must be a valid address.`, { value });
  }
  return value;
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
};

export const loadAuctionEnv = (env: AuctionEnv): { addresses: AuctionAddresses; pool: { fee: number; tickSpacing: number } } => {
  return {
    addresses: {
      hookAddress: parseAddress(env.NEXT_PUBLIC_HOOK_ADDRESS, "NEXT_PUBLIC_HOOK_ADDRESS"),
      poolManagerAddress: parseAddress(env.NEXT_PUBLIC_POOL_MANAGER_ADDRESS, "NEXT_PUBLIC_POOL_MANAGER_ADDRESS"),
      token0Address: parseAddress(env.NEXT_PUBLIC_TOKEN0_ADDRESS, "NEXT_PUBLIC_TOKEN0_ADDRESS"),
      paymentTokenAddress: parseAddress(env.NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS, "NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS"),
      auctionTokenAddress: parseAddress(env.NEXT_PUBLIC_AUCTION_TOKEN_ADDRESS, "NEXT_PUBLIC_AUCTION_TOKEN_ADDRESS"),
    },
    pool: {
      fee: parseNumber(env.NEXT_PUBLIC_POOL_FEE, 3_000),
      tickSpacing: parseNumber(env.NEXT_PUBLIC_POOL_TICK_SPACING, 60),
    },
  };
};
