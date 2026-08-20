import {
  bybit,
  okx,
  mexc,
  bitget,
  gateio,
  kucoinfutures,
} from "npm:ccxt@4.5.74";

type ExchangeCtor = new (config: Record<string, unknown>) => any;
type ExchangeConfig = { Ctor: ExchangeCtor; options?: Record<string, unknown> };

const EXCHANGE_CONFIG: Record<string, ExchangeConfig> = {
  bybit: {
    Ctor: bybit,
    options: { defaultType: "swap", defaultSubType: "linear", adjustForTimeDifference: true },
  },
  "tiger-bybit": {
    Ctor: bybit,
    options: { defaultType: "swap", defaultSubType: "linear", adjustForTimeDifference: true },
  },
  okx: {
    Ctor: okx,
    options: { defaultType: "swap", fetchMarkets: { types: ["swap"] }, adjustForTimeDifference: true },
  },
  mexc: {
    Ctor: mexc,
    options: { defaultType: "swap", adjustForTimeDifference: true },
  },
  bitget: {
    Ctor: bitget,
    options: { defaultType: "swap", adjustForTimeDifference: true },
  },
  gate: {
    Ctor: gateio,
    options: { defaultType: "swap", defaultSettle: "usdt", adjustForTimeDifference: true },
  },
  kucoin: {
    Ctor: kucoinfutures,
    options: { adjustForTimeDifference: true },
  },
};

export function isCcxtExchange(exchange: string): boolean {
  return Boolean(EXCHANGE_CONFIG[exchange]);
}

export function createCcxtExchange(
  exchange: string,
  apiKey: string,
  apiSecret: string,
  passphrase?: string | null,
) {
  const config = EXCHANGE_CONFIG[exchange];
  if (!config) throw new Error(`Биржа ${exchange} не поддерживается`);

  const exchangeConfig: Record<string, unknown> = {
    apiKey,
    secret: apiSecret,
    enableRateLimit: true,
    timeout: 30000,
    options: config.options || {},
  };

  // CCXT uses `password` for the passphrase on OKX, Bitget and KuCoin Futures.
  if (passphrase) exchangeConfig.password = passphrase;

  return new config.Ctor(exchangeConfig);
}

export function ccxtErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
