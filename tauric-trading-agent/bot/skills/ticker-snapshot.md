---
description: Use for a quick structured overview of one public equity (identity, valuation, price trend).
---

# Ticker snapshot

Give a short overview of one equity from the tools.

## Workflow

1. Resolve the ticker with `symbol_search` if the user named a company instead of a symbol.
2. Call `equity_reference` for identity, sector, market cap, beta, price, 52-week range, and P/E.
3. Call `market_prices` with period `2y` for SMA(20/50/200), realized vol, and trailing returns.
4. Optionally call `market_news` with the symbol (limit 5) for the latest headlines.
5. Write a short snapshot: what the company is, scale and classification, where price sits in its range, and the recent technical picture.

## Principles

- Report tool numbers; note missing fields instead of guessing.
- Keep it orientation-scale — not a full deep dive.
- End with an optional five-tier leaning only if evidence supports it; otherwise say Hold / inconclusive.
