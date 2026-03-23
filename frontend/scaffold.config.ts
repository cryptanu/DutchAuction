import * as chains from "viem/chains";

export type BaseConfig = {
  targetNetworks: readonly chains.Chain[];
  pollingInterval: number;
  alchemyApiKey: string;
  rpcOverrides?: Record<number, string>;
  walletConnectProjectId: string;
  burnerWalletMode: "localNetworksOnly" | "allNetworks" | "disabled";
};

export type ScaffoldConfig = BaseConfig;

export const DEFAULT_ALCHEMY_API_KEY = "cR4WnXePioePZ5fFrnSiR";

const baseSepoliaRpcUrl = process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL;

const scaffoldConfig = {
  targetNetworks: [chains.baseSepolia],
  pollingInterval: 3000,
  alchemyApiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || DEFAULT_ALCHEMY_API_KEY,
  rpcOverrides: (baseSepoliaRpcUrl
    ? { [chains.baseSepolia.id]: baseSepoliaRpcUrl }
    : undefined) as Record<number, string> | undefined,
  walletConnectProjectId:
    process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID || "3a8170812b534d0ff9d794f19a901d64",
  burnerWalletMode: "disabled",
} as const satisfies ScaffoldConfig;

export default scaffoldConfig;
