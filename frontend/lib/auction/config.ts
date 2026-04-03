import { Address, Hex, isAddress, isHex } from "viem";

export type AuctionAppConfig = {
  hookAddress?: Address;
  poolManagerAddress?: Address;
  token0Address?: Address;
  paymentTokenAddress?: Address;
  auctionTokenAddress?: Address;
  poolFee: number;
  poolTickSpacing: number;
  defaultSeller?: Address;
  /** When set, used instead of deriving pool id from the pool key (must be 32-byte hex). */
  poolIdOverride?: Hex;
};

export type RelayerAppConfig = {
  enabled: boolean;
  endpoint: string;
};

const toAddress = (value: string | undefined): Address | undefined => {
  if (!value || !isAddress(value)) return undefined;
  return value;
};

const toNumber = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toPoolIdBytes32 = (value: string | undefined): Hex | undefined => {
  if (!value || !isHex(value)) return undefined;
  if (value.length !== 66) return undefined;
  return value;
};

export const auctionConfig: AuctionAppConfig = {
  hookAddress: toAddress(process.env.NEXT_PUBLIC_HOOK_ADDRESS),
  poolManagerAddress: toAddress(process.env.NEXT_PUBLIC_POOL_MANAGER_ADDRESS),
  token0Address: toAddress(process.env.NEXT_PUBLIC_TOKEN0_ADDRESS),
  paymentTokenAddress: toAddress(process.env.NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS),
  auctionTokenAddress: toAddress(process.env.NEXT_PUBLIC_AUCTION_TOKEN_ADDRESS),
  poolFee: toNumber(process.env.NEXT_PUBLIC_POOL_FEE, 3000),
  poolTickSpacing: toNumber(process.env.NEXT_PUBLIC_POOL_TICK_SPACING, 60),
  defaultSeller: toAddress(process.env.NEXT_PUBLIC_DEFAULT_SELLER_ADDRESS),
  poolIdOverride: toPoolIdBytes32(process.env.NEXT_PUBLIC_POOL_ID),
};

export const requiredEnvKeys = [
  "NEXT_PUBLIC_HOOK_ADDRESS",
  "NEXT_PUBLIC_POOL_MANAGER_ADDRESS",
  "NEXT_PUBLIC_TOKEN0_ADDRESS",
  "NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS",
  "NEXT_PUBLIC_AUCTION_TOKEN_ADDRESS",
] as const;

export const isAuctionConfigReady = Boolean(
  auctionConfig.hookAddress &&
    auctionConfig.poolManagerAddress &&
    auctionConfig.token0Address &&
    auctionConfig.paymentTokenAddress &&
    auctionConfig.auctionTokenAddress,
);

const toBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

export const relayerConfig: RelayerAppConfig = {
  enabled: toBoolean(process.env.NEXT_PUBLIC_RELAYER_ENABLED, false),
  endpoint: process.env.NEXT_PUBLIC_RELAYER_ENDPOINT || "/api/relayer/finalize-pending",
};
