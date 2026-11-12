import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { asRecord, tauricGet } from "../lib/tauric";
import { resolveSymbol } from "../lib/symbols";

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export default defineTool({
  description: prompt`
    Financial-health ratios and valuation multiples for a public equity: liquidity
    (current, quick), leverage (debt/equity, net debt), returns (ROA, ROE), and
    multiples (trailing/forward P/E, P/S, P/B, PEG, dividend yield). Complements
    equity_fundamentals for valuation and credit work.
  `,
  effect: "read",
  execution: "server",
  inputSchema: z.object({
    symbol: z.string().trim().min(1).describe("Equity ticker, e.g. NVDA."),
  }),
  async execute({ symbol }) {
    const inst = resolveSymbol(symbol);
    if (inst.kind !== "security") {
      throw new Error(`equity_ratios only serves listed equities; got ${inst.kind}`);
    }
    const ticker = inst.label;
    const profile = asRecord(await tauricGet(`/securities/${ticker}/profile`)) ?? {};
    const instrument = asRecord(profile.instrument) ?? {};
    const totalDebt = num(profile.total_debt);
    const totalCash = num(profile.total_cash);
    const netDebt =
      totalDebt !== null && totalCash !== null ? totalDebt - totalCash : null;

    const ratios = {
      current_ratio: num(profile.current_ratio),
      quick_ratio: num(profile.quick_ratio),
      debt_to_equity: num(profile.debt_to_equity),
      net_debt: netDebt,
      return_on_assets: num(profile.return_on_assets),
      return_on_equity: num(profile.return_on_equity),
      trailing_pe: num(profile.pe_ratio),
      forward_pe: num(profile.forward_pe),
      price_to_sales: num(profile.price_to_sales),
      price_to_book: num(profile.price_to_book),
      peg_ratio: num(profile.peg_ratio),
      dividend_yield: num(profile.dividend_yield),
      payout_ratio: num(profile.payout_ratio),
    };

    if (Object.values(ratios).every((v) => v === null)) {
      throw new Error(`no ratio data for '${ticker}': funds and indices publish none`);
    }

    return {
      ticker,
      currency: str(instrument.currency),
      valuation_as_of: str(profile.market_cap_price_date),
      ratios,
    };
  },
});
