-- API passphrases are required by OKX, Bitget and KuCoin Futures.
-- Keep this migration idempotent because some environments may already have the column.
ALTER TABLE public.exchange_keys
ADD COLUMN IF NOT EXISTS api_passphrase text;

COMMENT ON COLUMN public.exchange_keys.api_passphrase IS
  'Encrypted API passphrase/password used by exchanges such as OKX, Bitget and KuCoin Futures.';
