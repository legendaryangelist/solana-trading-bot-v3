import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { asArray, asRecord, tauricGet } from "../lib/tauric";

const FILTERS: Record<string, Record<string, string>> = {
  any: {},
  equity: { kind: "security", instrument_type: "stock" },
  etf: { kind: "security", instrument_type: "etf" },
  fund: { kind: "security", instrument_type: "fund" },
  index: { kind: "series", instrument_type: "index" },
  future: { kind: "future" },
  currency: { kind: "fx" },
  cryptocurrency: { kind: "crypto" },
};

const INDEX_CARET: Record<string, string> = {
  "us.equity_index.sp500": "^GSPC",
  "us.equity_index.djia": "^DJI",
  "us.equity_index.nasdaq_composite": "^IXIC",
  "us.equity_index.russell_2000": "^RUT",
  "us.volatility_index.vix": "^VIX",
};

function matchSymbol(item: Record<string, unknown>): {
  symbol: string;
  key: string;
  name: string | null;
  instrument_type: string | null;
} {
  const key = String(item.key ?? "");
  const [kind, rest = ""] = key.split(":");
  const classification = asRecord(item.classification);
  const instrumentType =
    classification && typeof classification.instrument_type === "string"
      ? classification.instrument_type
      : null;
  let symbol = rest;
  if (kind === "future") {
    symbol = `${rest.replace(/\/continuous$/i, "").split(":").pop()}=F`;
  } else if (kind === "series") {
    symbol = INDEX_CARET[rest] ?? key;
  }
  return {
    symbol,
    key,
    name: typeof item.name === "string" ? item.name : null,
    instrument_type: instrumentType,
  };
}

export default defineTool({
  description: prompt`
    Find the symbol for a company, fund, index, future, FX pair, or crypto asset
    by name or partial ticker in Tauric's registry. Use before guessing a ticker.
    Pass the returned symbol to market_quotes, market_prices, or equity tools.
  `,
  effect: "read",
  execution: "server",
  inputSchema: z.object({
    query: z.string().trim().min(1).max(80).describe("Name or partial symbol."),
    asset_type: z
      .enum([
        "any",
        "equity",
        "etf",
        "fund",
        "index",
        "future",
        "currency",
        "cryptocurrency",
      ])
      .default("any"),
    limit: z.number().int().min(1).max(20).default(8),
  }),
  async execute({ query, asset_type, limit }) {
    const body = await tauricGet("/instruments", {
      q: query,
      limit,
      ...FILTERS[asset_type],
    });
    const items = asArray(body.data)
      .map((row) => asRecord(row))
      .filter((row): row is Record<string, unknown> => Boolean(row))
      .filter((row) => {
        const key = String(row.key ?? "");
        return !key.startsWith("future:") || key.endsWith("/continuous");
      })
      .map(matchSymbol);

    if (items.length === 0) {
      throw new Error(
        `no symbol matched '${query}': try a fuller or simpler English name, or asset_type any`,
      );
    }

    return { query, asset_type, matches: items };
  },
});
