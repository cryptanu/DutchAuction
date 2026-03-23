import { Hex } from "viem";

export type CofheHookDataBuilder = (intent: {
  desiredAuctionTokens: string;
  maxPricePerToken: string;
  minPaymentTokensFromSwap: string;
}) => Promise<Hex> | Hex;

let injectedBuilder: CofheHookDataBuilder | undefined;

export const injectCofheHookDataBuilder = (builder: CofheHookDataBuilder | undefined): void => {
  injectedBuilder = builder;
};

export const getCofheHookDataBuilder = (): CofheHookDataBuilder | undefined => {
  return injectedBuilder;
};
