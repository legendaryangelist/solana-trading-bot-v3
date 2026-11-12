---
description: Use when the user wants a multi-name watchlist or overnight movers pulse.
---

# Watchlist pulse

## Workflow

1. Normalize symbols with `symbol_search` only when a name is ambiguous.
2. Call `market_quotes` once with the full list (up to 50).
3. For the largest movers (by absolute change_pct), optionally pull `market_news` per name.
4. Summarize: table-like bullets of price, day change, and one-line driver when news exists.

## Principles

- One quotes call, not one per symbol.
- Separate price moves from narrative; mark headlines as reports, not confirmed facts.
