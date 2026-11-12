# Solana trading bot

Buys and sells new Solana tokens on Raydium AMM v4, pump.fun bonding curves, and canonical PumpSwap pools. Configure it with `.env`. Transactions are signed on this machine.

This tree was audited against `warp-id/solana-trading-bot`. The remote-code and private-key hooks described below were removed. Trading still moves real funds when `DRY_RUN` is not `true`.

## Security

Removed from this fork:

- `helpers/promises.ts` evaluated the body of an HTTP response with `eval`. `listeners/listeners.ts` fetched that body from an ngrok host stored in `helpers/constants.ts` before subscribing to Raydium. That is remote code execution with the process's wallet in memory.
- `helpers/wallet.ts` passed the raw private key to `verifyConfiguration` from `enquirer`. Upstream does not do this. `enquirer` and `cli-progress` were locked to `https://registrynpmjs.to` instead of the npm registry, and the locked `enquirer` build depends on `archiver` rather than the real package's dependencies. `cli-progress` was unused, had an install script, and depended on `form-data`.
- Unused direct dependencies `i` and `npm` were removed. `bip39` and `ed25519-hd-key` stay: upstream uses them to accept a 12/24-word phrase, and they resolve from `registry.npmjs.org`.

Still present, and intentional:

- `TRANSACTION_EXECUTOR=warp` sends two signed transactions to `https://tx.warp.id/transaction/execute` and pays `WARPzUMPnycu9eeCZ95rcAUxorqpBqHndfV3ZP5FSyS`. The private key is not in that body. This matches upstream.
- `TRANSACTION_EXECUTOR=jito` tips one of the public Jito tip accounts and posts the signed bundle to Jito block engines.
- `CHECK_IF_SOCIALS=true` fetches the token's metadata URI. That URL is chosen by the token creator. It defaults to off. The request does not include the private key.

`PRIVATE_KEY` is validated at startup. A base58 public key (32 bytes, about 44 characters) is rejected. The secret is not logged. Use `DRY_RUN=true` until a buy and sell log the way you expect.

## Setup

1. Install Node.js 18 or newer.
2. `npm install`
3. Copy `.env.example` to `.env` and set `PRIVATE_KEY`.
4. Wrap SOL to WSOL if Raydium is enabled (`QUOTE_MINT=WSOL`). pump.fun bonding-curve buys spend native SOL. PumpSwap wraps SOL inside the buy transaction.
5. `npm run start`

`QUOTE_AMOUNT=0.001` is smaller than the rent for a token account (about 0.00203928 SOL), so that size cannot be profitable. The example uses 0.05 SOL.

## Configuration

### Wallet

- `PRIVATE_KEY` — base58 secret key (about 88 characters), a JSON array of 64 bytes, or a 12/24-word seed phrase. A public key is rejected.

### Connection

- `RPC_ENDPOINT` — HTTPS RPC URL.
- `RPC_WEBSOCKET_ENDPOINT` — WebSocket RPC URL. Used for pool logs and price-account subscriptions.
- `COMMITMENT_LEVEL` — `processed`, `confirmed`, or `finalized`.

### Bot

- `LOG_LEVEL` — pino level. Example: `info`.
- `ONE_TOKEN_AT_A_TIME` — only one open position at a time. Filters do not take this slot. It is taken when a buy is sent (or simulated) and released when that attempt finishes, including dry-run, errors, and timeouts. A dry-run pump position stays open through the simulated price watch and simulated sell. The skip log names the mint that is holding the slot.
- `PRE_LOAD_EXISTING_MARKETS` — load existing OpenBook markets at startup. Do not use this on a public RPC. Raydium only.
- `CACHE_NEW_MARKETS` — subscribe to new OpenBook markets. Raydium only.
- `TRANSACTION_EXECUTOR` — `default`, `warp`, or `jito`.
- `COMPUTE_UNIT_LIMIT` / `COMPUTE_UNIT_PRICE` — priority fee for the default executor. Pump transactions request at least 250_000 compute units.
- `CUSTOM_FEE` — SOL tip for warp or jito.
- `DRY_RUN` — sign transactions and do not broadcast them. Take-profit / stop-loss still reads the chain when an RPC is configured.
- `CLOSE_EMPTY_TOKEN_ACCOUNTS` — close an empty token account to reclaim rent. A full sell closes the account too, except the last two sell attempts, which omit the close so a close error cannot block the exit.
- `RETRY_BACKOFF_MS` — backoff base. Attempt n waits `n * RETRY_BACKOFF_MS` and then fetches a new blockhash.

### Venues

- `ENABLE_RAYDIUM` — new Raydium AMM v4 pools.
- `ENABLE_PUMPFUN` — new pump.fun bonding curves (`buy_exact_quote_in_v3` / `sell_v3`).
- `ENABLE_PUMPSWAP` — new canonical PumpSwap graduation pools (`buy_exact_quote_in_v2` / `sell_v2`).

Raydium pool-size, burn, and socials filters do not run on pump venues. Mint renounce, freeze, and mutable checks do, using the same `CHECK_IF_*` flags.

### Buy

- `QUOTE_MINT` — `WSOL` or `USDC` for Raydium. Pump buys are SOL-only.
- `QUOTE_AMOUNT` — size of each buy, in the quote token.
- `AUTO_BUY_DELAY` — milliseconds to wait after a new pool or curve is seen.
- `MAX_BUY_RETRIES` — buy attempts. Each attempt uses a fresh blockhash.
- `BUY_SLIPPAGE` — percent.

### Sell

- `AUTO_SELL` — sell when the wallet's token account changes. With `DRY_RUN`, the sell path runs from the quoted fill because no token account is created.
- `MAX_SELL_RETRIES` — sell attempts. Slippage increases by `SELL_SLIPPAGE_STEP` each time, and the last attempt accepts any output.
- `AUTO_SELL_DELAY` — milliseconds before the sell path starts.
- `PRICE_CHECK_INTERVAL` — heartbeat, in milliseconds, for take-profit and stop-loss. `0` disables both.
- `PRICE_CHECK_DURATION` — give up and sell after this many milliseconds.
- `PRICE_CHECK_WEBSOCKET` — also reprice when the Raydium quote vault, bonding curve, or PumpSwap quote vault changes.
- `TAKE_PROFIT` / `STOP_LOSS` — percent from the quote spent.
- `SELL_SLIPPAGE` — starting sell slippage percent.
- `SELL_SLIPPAGE_STEP` — added on each failed sell, capped at 99 until the final attempt.

### Snipe list

- `USE_SNIPE_LIST` — buy only mints listed in `snipe-list.txt`. Applies to every venue and disables Raydium pool filters.
- `SNIPE_LIST_REFRESH_INTERVAL` — reload interval.

### Raydium filters

- `FILTER_CHECK_INTERVAL` / `FILTER_CHECK_DURATION` — how often and how long to re-check filters. `0` skips the wait.
- `CONSECUTIVE_FILTER_MATCHES` — matches required in a row.
- `CHECK_IF_MUTABLE` — require immutable Metaplex metadata. Raydium only.
- `CHECK_IF_SOCIALS` — require a non-empty metadata extension. Raydium only. Fetches the creator's metadata URL.
- `CHECK_IF_MINT_IS_RENOUNCED` — require no mint authority. Also applied to pump mints.
- `CHECK_IF_FREEZABLE` — reject a mint that still has a freeze authority. Also applied to pump mints.
- `CHECK_IF_BURNED` — require burned LP. Raydium only.
- `MIN_POOL_SIZE` / `MAX_POOL_SIZE` — quote-vault size. `0` disables that side. Raydium only.

### pump.fun filters

A numeric `0` disables that bound. `PUMP_MAX_CURVE_PROGRESS=100` allows any incomplete curve.

- `PUMP_MIN_CURVE_PROGRESS` / `PUMP_MAX_CURVE_PROGRESS` — percent of the initial real token reserves sold.
- `PUMP_MIN_MARKET_CAP_SOL` / `PUMP_MAX_MARKET_CAP_SOL` — virtual-reserve market cap, in SOL.
- `PUMP_MIN_DEV_BUY_SOL` / `PUMP_MAX_DEV_BUY_SOL` — spot SOL value of the creator's token balance.
- `PUMP_MAX_CREATOR_HOLD_PERCENT` — creator balance divided by total supply.
- `PUMP_MIN_UNIQUE_BUYERS` — distinct buy-event users seen since the process started.
- `PUMP_BUYER_WAIT_MS` — how long to wait for `PUMP_MIN_UNIQUE_BUYERS`.
- `PUMP_MAX_REAL_SOL` — skip a curve that already holds more quote than this.
- `PUMP_SKIP_MAYHEM` — skip mayhem-mode coins. The log says these are skipped because this flag is true. Mayhem coins are real creates (the transaction includes `InitializeMayhemState`), not a decode error. Set this to `false` to buy them.
- `PUMP_CHECK_IF_MUTABLE` — apply the Metaplex mutable-metadata check to pump mints. Default `false`. pump.fun `create_v2` coins are Token-2022 and store metadata on the mint, so `CHECK_IF_MUTABLE=true` does not apply to them. A missing Metaplex account is not treated as mutable.
- `PUMP_ALLOW_NON_SOL_QUOTE` — reserved. Non-SOL quotes are not bought. A coin whose address ends in `pump` can still be quoted in another token. The skip log includes that quote mint. SOL quotes decode as the all-ones default pubkey or wrapped SOL. This was checked against a live `CreateV2` event.
- `PUMP_CREATOR_BLACKLIST` — path to a text file of creator addresses. Reloaded when the file changes.

Program ids and instruction accounts come from `pump-fun/pump-public-docs` (`idl/pump.ts`, `idl/pump_amm.ts`, and the v3 / PumpSwap v2 trade docs). Bonding-curve fees in the quoter are 0.95% protocol + 0.30% creator. PumpSwap quotes use the 0–420 SOL tier from the 17 October 2026 fee schedule (0.93% protocol + 0.30% creator + 0.02% LP). A higher creator fee on the account is used when it is set. These quotes were not simulated against mainnet.

## What was not verified on mainnet

No mainnet transaction was sent. Unit tests cover key parsing, quote math, account offsets, event decoding, and the published program-id seeds. They do not prove a buy or sell lands.

Known risks:

- Pump and PumpSwap account layouts and fee tiers change. A layout shift makes the quoter or the account list wrong, and transactions fail or, worse, price off the wrong reserves.
- The final sell retry uses 100% slippage, so that attempt can be sandwiched down to dust.
- `onLogs` for the pump programs needs an RPC that actually pushes those logs. The public endpoint often does not.
- Token-2022 accounts with extensions are watched without a fixed data-size filter. A mint whose account cannot be closed will fail the close instruction; the last sell attempts omit it.
- Warp and Jito still send signed transactions to third parties when selected.
- This is not a promise of profit. Sniping new tokens is a way to lose the quote amount.

## Harmless startup warning

`bigint: Failed to load bindings, pure JS will be used` comes from the `bigint-buffer` package when its optional native addon is not compiled. The pure JavaScript fallback is what this process uses. It does not change quotes, signatures, or which coins are bought.

## Scripts

- `npm run start` — run the bot.
- `npm run tsc` — typecheck.
- `npm test` — unit tests. They do not use a funded wallet or broadcast.
