---
description: Use for a grounded single-name equity brief with thesis, catalysts, risks, and a five-tier rating.
---

# Equity brief

A concise research brief for one name, in the spirit of Trading-R1: facts first, then a volatility-aware stance.

## Workflow

1. Resolve the symbol (`symbol_search` when needed).
2. Pull `equity_reference`, `equity_fundamentals`, and `equity_ratios`.
3. Pull `market_prices` (`1y` or `2y`) for trend and realized volatility context.
4. Pull `market_news` for the symbol (and a topic query if a catalyst is named).
5. Optionally pull `macro_snapshot` for a sector-relevant category (e.g. Inflation, Treasury Yields, Fed Policy & Rates, Growth & Output).
6. Synthesize: thesis, key figures with sources (tool names), catalysts, risks.
7. Call `record_recommendation` with one of: strong_buy, buy, hold, sell, strong_sell.

## Output shape

- **Thesis** — 3–6 sentences, evidence-linked.
- **Figures** — market cap, price, multiples, growth, leverage; mark estimates as estimates.
- **Rating** — five-tier scale with one sentence on why not the adjacent tiers.
- **Risks / catalysts** — bullets.
- **Disclaimer** — research and education only, not investment advice.

## Principles

- Investigate before concluding; do not invent filings or prices.
- When tools disagree or data is missing, say so.
- Prefer Hold when evidence is thin.
- Never claim an order was placed.
