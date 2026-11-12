# tauric-trading-agent

Agent SDK research agent modeled on [TauricResearch/Trading-R1](https://github.com/TauricResearch/Trading-R1).

It calls Tauric market data (`https://api.tauric.ai/v1`) for quotes, prices, equity reference/fundamentals/ratios, news, and macro snapshots, then can store a five-tier recommendation (`strong_buy` … `strong_sell`). Research and education only — not investment advice, and it does not place trades.

## Setup

```bash
cd tauric-trading-agent
npm install
export TAURIC_API_KEY=…   # https://tauric.ai/settings/api-keys
npx @grok/agent-sdk login # Cursor credential for model turns
```

## Local loop

```bash
npx @grok/agent-sdk validate --dir .
npx @grok/agent-sdk info --dir . --json
npx @grok/agent-sdk tool call market_quotes --dir . --input '{"symbols":["AAPL","NVDA"]}'
npx @grok/agent-sdk run --dir . --message "Ticker snapshot for NVDA"
npx @grok/agent-sdk dev --dir .
npx @grok/agent-sdk eval --dir .
npm run check
```

## Tools

| Tool | Role |
| --- | --- |
| `symbol_search` | Resolve company / instrument names |
| `market_quotes` | Batch live quotes |
| `market_prices` | Daily history + SMA / vol / returns |
| `equity_reference` | Identity + market snapshot |
| `equity_fundamentals` | Profile fundamentals |
| `equity_ratios` | Health ratios + multiples |
| `market_news` | Tauric news store |
| `macro_snapshot` | US macro category dashboard |
| `record_recommendation` / `recall_recommendation` | Persist / read five-tier thesis |

Skills: `ticker-snapshot`, `equity-brief`, `watchlist-pulse`.
