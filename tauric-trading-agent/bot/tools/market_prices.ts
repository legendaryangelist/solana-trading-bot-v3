import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { asArray, asRecord, tauricGet } from "../lib/tauric";
import { resolveSymbol } from "../lib/symbols";

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function sma(values: number[], window: number): number | null {
  if (values.length < window) return null;
  const windowValues = values.slice(-window);
  let sum = 0;
  for (const value of windowValues) sum += value;
  return sum / windowValues.length;
}

function pct(from: number, to: number): number {
  return (to - from) / from;
}

export default defineTool({
  description: prompt`
    OHLCV daily price history plus a compact technical summary for one instrument:
    stocks, ETFs, indices (^GSPC), futures (CL=F), FX (EURUSD=X), crypto (BTC-USD).
    Returns recent closes, SMA(20/50/200) when enough history exists, realized vol,
    trailing returns, and the window high/low. Use period presets like 1mo, 3mo, 1y, 2y.
  `,
  effect: "read",
  execution: "server",
  inputSchema: z.object({
    symbol: z.string().trim().min(1).describe("Instrument symbol, e.g. AAPL or BTC-USD."),
    period: z
      .enum(["1mo", "3mo", "6mo", "1y", "2y", "5y"])
      .default("1y")
      .describe("Lookback window ending today."),
  }),
  async execute({ symbol, period }) {
    const inst = resolveSymbol(symbol);
    const periodDays: Record<string, number> = {
      "1mo": 31,
      "3mo": 92,
      "6mo": 183,
      "1y": 366,
      "2y": 730,
      "5y": 5 * 366,
    };
    const body = await tauricGet(`${inst.path}/history`, {
      interval: "1d",
      period,
    });

    const bars = asArray(body.data ?? body.bars ?? body.history)
      .map((row) => asRecord(row))
      .filter((row): row is Record<string, unknown> => Boolean(row));

    const closes: { date: string; close: number }[] = [];
    for (const bar of bars) {
      const date = str(bar.date ?? bar.session_date ?? bar.t ?? bar.timestamp);
      const close = num(bar.close ?? bar.c ?? bar.value ?? bar.open);
      if (date && close !== null) closes.push({ date, close });
    }
    closes.sort((a, b) => a.date.localeCompare(b.date));

    if (closes.length < 2) {
      throw new Error(
        `no daily history for '${symbol}' over ${period}: try another period or symbol_search`,
      );
    }

    const series = closes.map((c) => c.close);
    const last = series[series.length - 1]!;
    const returns: Record<string, number | null> = {};
    const lookbacks: Record<string, number> = {
      "1d": 1,
      "1w": 5,
      "1m": 21,
      "3m": 63,
      "6m": 126,
      "1y": 252,
    };
    for (const [name, n] of Object.entries(lookbacks)) {
      const from = series[series.length - 1 - n];
      returns[name] = from !== undefined && from !== 0 ? pct(from, last) : null;
    }

    const simpleReturns: number[] = [];
    for (let i = 1; i < series.length; i++) {
      const prev = series[i - 1]!;
      if (prev !== 0) simpleReturns.push(pct(prev, series[i]!));
    }
    const mean =
      simpleReturns.length === 0
        ? 0
        : simpleReturns.reduce((a, b) => a + b, 0) / simpleReturns.length;
    const variance =
      simpleReturns.length === 0
        ? 0
        : simpleReturns.reduce((a, b) => a + (b - mean) ** 2, 0) /
          Math.max(simpleReturns.length - 1, 1);
    const periodsPerYear = inst.kind === "crypto" ? 365 : inst.kind === "fx" ? 260 : 252;
    const realizedVol = Math.sqrt(variance * periodsPerYear);

    let high = closes[0]!;
    let low = closes[0]!;
    for (const c of closes) {
      if (c.close > high.close) high = c;
      if (c.close < low.close) low = c;
    }

    return {
      symbol: inst.label,
      key: inst.key,
      period,
      bars: closes.length,
      requested_days: periodDays[period],
      last_close: last,
      last_date: closes[closes.length - 1]!.date,
      sma20: sma(series, 20),
      sma50: sma(series, 50),
      sma200: sma(series, 200),
      realized_vol_annualized: realizedVol,
      trailing_returns: returns,
      window_high: high,
      window_low: low,
      recent_closes: closes.slice(-10),
      notes: inst.note ? [inst.note] : [],
    };
  },
});
