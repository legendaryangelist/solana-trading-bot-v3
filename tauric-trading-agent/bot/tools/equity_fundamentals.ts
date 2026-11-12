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
    Fundamental financial summary for a public equity from Tauric's profile and quote:
    revenue growth, earnings growth, margins, cash, debt, ROE, trailing/forward EPS,
    and price-to-book. Numbers only — interpret them in the reply. For ratios and
    multiples prefer equity_ratios; for identity prefer equity_reference.
  `,
  effect: "read",
  execution: "server",
  inputSchema: z.object({
    symbol: z.string().trim().min(1).describe("Equity ticker, e.g. NVDA."),
  }),
  async execute({ symbol }) {
    const inst = resolveSymbol(symbol);
    if (inst.kind !== "security") {
      throw new Error(`equity_fundamentals only serves listed equities; got ${inst.kind}`);
    }
    const ticker = inst.label;
    const profile = asRecord(await tauricGet(`/securities/${ticker}/profile`)) ?? {};
    const instrument = asRecord(profile.instrument) ?? {};

    if (!instrument.name && num(profile.market_cap) === null) {
      throw new Error(`no fundamentals for '${ticker}': check the ticker`);
    }

    const totalDebt = num(profile.total_debt);
    const totalCash = num(profile.total_cash);
    const netDebt =
      totalDebt !== null && totalCash !== null ? totalDebt - totalCash : null;

    return {
      ticker,
      currency: str(instrument.currency),
      financial_currency: str(profile.financial_currency),
      valuation_as_of: str(profile.market_cap_price_date),
      market_cap: num(profile.market_cap),
      enterprise_value: num(profile.enterprise_value),
      total_cash: totalCash,
      total_debt: totalDebt,
      net_debt: netDebt,
      gross_margin: num(profile.gross_margin),
      operating_margin: num(profile.operating_margin),
      profit_margin: num(profile.profit_margin),
      return_on_equity: num(profile.return_on_equity),
      revenue_growth: num(profile.revenue_growth),
      earnings_growth: num(profile.earnings_growth),
      free_cashflow: num(profile.free_cashflow),
      operating_cashflow: num(profile.operating_cashflow),
      trailing_eps: num(profile.trailing_eps ?? profile.eps),
      forward_eps: num(profile.forward_eps),
      price_to_book: num(profile.price_to_book),
      notes:
        profile.financial_currency &&
        instrument.currency &&
        profile.financial_currency !== instrument.currency
          ? [
              `${ticker} reports in ${profile.financial_currency}, not listing currency ${instrument.currency}: treat cross-currency multiples carefully.`,
            ]
          : [],
    };
  },
});
