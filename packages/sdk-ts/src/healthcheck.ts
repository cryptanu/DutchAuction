import type { AuctionClientConfig, AuctionHealthcheck } from "./types.js";
import { nonEmptyCode } from "./utils.js";

export const runHealthcheck = async (config: AuctionClientConfig): Promise<AuctionHealthcheck> => {
  let rpc = false;
  try {
    await config.publicClient.getBlockNumber();
    rpc = true;
  } catch {
    rpc = false;
  }

  const [hookCode, poolManagerCode, token0Code, paymentCode, auctionCode] = await Promise.all([
    config.publicClient.getCode({ address: config.addresses.hookAddress }).catch(() => "0x" as const),
    config.publicClient.getCode({ address: config.addresses.poolManagerAddress }).catch(() => "0x" as const),
    config.publicClient.getCode({ address: config.addresses.token0Address }).catch(() => "0x" as const),
    config.publicClient.getCode({ address: config.addresses.paymentTokenAddress }).catch(() => "0x" as const),
    config.publicClient.getCode({ address: config.addresses.auctionTokenAddress }).catch(() => "0x" as const),
  ]);

  return {
    chainId: config.chainId,
    rpc,
    cofheAvailable: Boolean(config.cofhe),
    decryptForView: Boolean(config.cofhe?.decryptForView),
    decryptForTx: Boolean(config.cofhe?.decryptForTx),
    contractReachability: {
      hook: nonEmptyCode(hookCode),
      poolManager: nonEmptyCode(poolManagerCode),
      token0: nonEmptyCode(token0Code),
      paymentToken: nonEmptyCode(paymentCode),
      auctionToken: nonEmptyCode(auctionCode),
    },
  };
};
