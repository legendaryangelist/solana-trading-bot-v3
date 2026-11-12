import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { asRecord, tauricPost } from "../lib/tauric";
import { resolveSymbol } from "../lib/symbols";

type QuoteView = {
  price: number | null;
  change: number | null;
  change_pct: number | null;
  previous_close: number | null;
  day_high: number | null;
  day_low: number | null;
  volume: number | null;
  high_52w: number | null;
  low_52w: number | null;
  currency: string | null;
  market_state: string | null;
  as_of: string | null;
  session_date: string | null;
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function toQuote(q: Record<string, unknown>): QuoteView {
  const day = asRecord(q.day) ?? {};
  const span = asRecord(q.range_52w) ?? {};
  const prev = asRecord(q.previous_close) ?? {};
  const instrument = asRecord(q.instrument) ?? {};
  return {
    price: num(q.price),
    change: num(q.change),
    change_pct: num(q.change_percent),
    previous_close: num(prev.value),
    day_high: num(day.high),
    day_low: num(day.low),
    volume: num(day.volume),
    high_52w: num(span.high),
    low_52w: num(span.low),
    currency: str(instrument.currency),
    market_state: str(q.market_state),
    as_of: str(q.source_time),
    session_date: str(q.session_date),
  };
}

export default defineTool({
  description: prompt`
    Current quotes for up to 50 instruments in one call: last price, day change,
    previous close, day/52-week range, volume, and market state. Accepts tickers,
    indices (^GSPC), futures (CL=F), FX (EURUSD=X), and crypto (BTC-USD).
    Prefer for watchlists; use equity_reference for one company's valuation snapshot.
  `,
  effect: "read",
  execution: "server",
  inputSchema: z.object({
    symbols: z
      .array(z.string().trim().min(1))
      .min(1)
      .max(50)
      .describe("Symbols to quote, e.g. ['NVDA','AAPL','^GSPC','BTC-USD']."),
  }),
  async execute({ symbols }) {
    const asked = new Map<string, string[]>();
    const labels = new Map<string, string>();
    const leftOut: Record<string, string> = {};
    const notes: string[] = [];

    for (const symbol of symbols) {
      try {
        const inst = resolveSymbol(symbol);
        if (inst.note && !notes.includes(inst.note)) notes.push(inst.note);
        const list = asked.get(inst.key) ?? [];
        if (!list.includes(symbol)) list.push(symbol);
        asked.set(inst.key, list);
        if (!labels.has(inst.key)) labels.set(inst.key, inst.label);
      } catch (err) {
        leftOut[symbol] = err instanceof Error ? err.message : String(err);
      }
    }

    if (asked.size === 0) {
      throw new Error(`no symbol could be quoted: ${Object.values(leftOut).join("; ")}`);
    }

    const body = await tauricPost("/quotes", { instruments: [...asked.keys()] });
    const data = asRecord(body.quotes) ?? {};
    const errors = asRecord(body.errors) ?? {};
    const quotes: Record<string, QuoteView> = {};

    for (const [key, spellings] of asked) {
      const row = asRecord(data[key]);
      if (row && num(row.price) !== null) {
        const label = labels.get(key)!;
        const outLabel = quotes[label] ? key : label;
        quotes[outLabel] = toQuote(row);
      } else {
        const why =
          str(asRecord(errors[key])?.message) ?? "no price right now";
        for (const symbol of spellings) leftOut[symbol] = why;
      }
    }

    if (Object.keys(quotes).length === 0) {
      throw new Error(`no quotes available: ${Object.values(leftOut).join("; ")}`);
    }

    return { quotes, left_out: leftOut, notes };
  },
});
