import {
  BASE_SEPOLIA_CHAIN_ID,
  createAuctionClient,
  type AuctionClient,
  type AuctionClientConfig,
  type CofheAdapter,
} from "../../../packages/sdk-ts/dist/src/index.js";
import type { Address, Hex } from "viem";

type FrontendPublicClient = {
  getBlockNumber: () => Promise<bigint>;
  getCode: (input: { address: Address }) => Promise<Hex>;
  readContract: (input: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }) => Promise<unknown>;
};

type WriteContractAsync = (input: {
  chainId?: number;
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
}) => Promise<Hex>;

type FrontendAuctionClientInput = {
  publicClient: FrontendPublicClient;
  writeContractAsync?: WriteContractAsync;
  addresses: AuctionClientConfig["addresses"];
  pool: AuctionClientConfig["pool"];
  cofhe?: CofheAdapter;
};

export const createFrontendAuctionClient = (input: FrontendAuctionClientInput): AuctionClient => {
  const writeContractAsync = input.writeContractAsync;
  const walletClient = writeContractAsync
    ? {
        writeContract: async (request: {
          address: Address;
          abi: readonly unknown[];
          functionName: string;
          args?: readonly unknown[];
          chain?: { id: number };
        }): Promise<Hex> => {
          return writeContractAsync({
            chainId: request.chain?.id,
            address: request.address,
            abi: request.abi,
            functionName: request.functionName,
            args: request.args,
          });
        },
      }
    : undefined;

  return createAuctionClient({
    chainId: BASE_SEPOLIA_CHAIN_ID,
    publicClient: {
      getBlockNumber: input.publicClient.getBlockNumber,
      getCode: input.publicClient.getCode,
      readContract: input.publicClient.readContract,
    },
    walletClient,
    addresses: input.addresses,
    pool: input.pool,
    cofhe: input.cofhe,
  });
};
