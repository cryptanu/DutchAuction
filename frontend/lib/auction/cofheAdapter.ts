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

type WindowWithCofhe = Window & {
  __dutchAuctionCofhe?: {
    buildAuctionIntentHookData?: CofheHookDataBuilder;
  };
  __cofheBuildAuctionIntentHookData?: CofheHookDataBuilder;
  cofhe?: {
    buildAuctionIntentHookData?: CofheHookDataBuilder;
  };
  injectCofheHookDataBuilder?: (builder: CofheHookDataBuilder | undefined) => void;
  getCofheHookDataBuilder?: () => CofheHookDataBuilder | undefined;
};

const extractWindowBuilder = (win: WindowWithCofhe): CofheHookDataBuilder | undefined => {
  const explicit = win.__dutchAuctionCofhe?.buildAuctionIntentHookData;
  if (typeof explicit === "function") return explicit;

  const direct = win.__cofheBuildAuctionIntentHookData;
  if (typeof direct === "function") return direct;

  const legacy = win.cofhe?.buildAuctionIntentHookData;
  if (typeof legacy === "function") return legacy;

  return undefined;
};

export const tryAutoInjectCofheHookDataBuilderFromWindow = (): boolean => {
  if (injectedBuilder) return true;
  if (typeof window === "undefined") return false;

  const win = window as WindowWithCofhe;
  const builder = extractWindowBuilder(win);
  if (!builder) return false;

  injectCofheHookDataBuilder(builder);
  return true;
};

export const installCofheInjectionHelpersOnWindow = (): void => {
  if (typeof window === "undefined") return;
  const win = window as WindowWithCofhe;
  win.injectCofheHookDataBuilder = injectCofheHookDataBuilder;
  win.getCofheHookDataBuilder = getCofheHookDataBuilder;
};
