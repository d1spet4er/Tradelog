import {
  bybit,
  okx,
  mexc,
  bitget,
  gateio,
  kucoinfutures,
} from "npm:ccxt@4.5.74";

type ExchangeCtor = new (config: Record<string, unknown>) => any;

const EXCHANGE_CONFIG: Record<string, { Ctor: ExchangeCtor; options?: Record<string, unknown> }> = {
  bybit: { Ctor: bybit, options: { defaultType: "swap", defaultSubType: "linear" } },
  "tiger-bybit": { Ctor: bybit, options: { defaultType: "swap", defaultSubType: "linear" } },
  okx: {
    Ctor: okx,
    options: {
      defaultType: "swap",
      fetchMarkets: { types: ["swap"] },
    },
  },
  mexc: { Ctor: mexc, options: { defaultType: "swap" } },
  bitget: { Ctor: bitget, options: { defaultType: "swap" } },
  gate: { Ctor: gateio, options: { defaultType: "swap", defaultSettle: "usdt" } },
  kucoin: { Ctor: kucoinfutures },
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

  return new config.Ctor({
    apiKey,
    secret: apiSecret,
    password: passphrase || undefined,
    enableRateLimit: true,
    timeout: 30000,
    options: config.options || {},
  });
}

export function ccxtErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
