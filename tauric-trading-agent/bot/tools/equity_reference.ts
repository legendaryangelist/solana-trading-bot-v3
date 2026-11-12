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

function lead(text: string | null, max = 600): string | null {
  if (!text || text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = cut.lastIndexOf(". ");
  return end > 0 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

export default defineTool({
  description: prompt`
    Reference snapshot for a public equity: name, GICS sector/industry, country,
    exchange, market cap, enterprise value, shares, float, beta, current price,
    52-week range, trailing/forward P/E, and a short business summary.
    Use to identify and classify a ticker before deeper work.
  `,
  effect: "read",
  execution: "server",
  inputSchema: z.object({
    symbol: z.string().trim().min(1).describe("Equity ticker, e.g. NVDA or BRK.B."),
  }),
  async execute({ symbol }) {
    const inst = resolveSymbol(symbol);
    if (inst.kind !== "security") {
      throw new Error(`equity_reference only serves listed equities; got ${inst.kind} (${inst.label})`);
    }
    const ticker = inst.label;
    const [profileBody, quoteBody] = await Promise.all([
      tauricGet(`/securities/${ticker}/profile`),
      tauricGet(`/securities/${ticker}/quote`),
    ]);
    const profile = asRecord(profileBody) ?? {};
    const quote = asRecord(quoteBody) ?? {};
    const instrument = asRecord(profile.instrument) ?? {};
    const classification = asRecord(instrument.classification) ?? {};
    const span = asRecord(quote.range_52w) ?? {};

    if (!instrument.name && !profile.market_cap && num(quote.price) === null) {
      throw new Error(`no data for '${ticker}': check the ticker with symbol_search`);
    }

    return {
      ticker,
      long_name: str(instrument.name),
      currency: str(instrument.currency),
      exchange: str(instrument.venue),
      quote_type: str(classification.instrument_type),
      sector: str(profile.sector),
      industry_group: str(profile.industry_group),
      industry: str(profile.industry),
      sub_industry: str(profile.sub_industry),
      country: str(profile.country),
      website: str(profile.website),
      employees: num(profile.employees),
      valuation_as_of: str(profile.market_cap_price_date),
      market_cap: num(profile.market_cap),
      enterprise_value: num(profile.enterprise_value),
      shares_outstanding: num(profile.shares_outstanding),
      float_shares: num(profile.float_shares),
      beta: num(profile.beta),
      current_price: num(quote.price),
      fifty_two_week_high: num(span.high),
      fifty_two_week_low: num(span.low),
      trailing_pe: num(profile.pe_ratio),
      forward_pe: num(profile.forward_pe),
      long_business_summary: lead(str(profile.business_summary)),
      session_date: str(quote.session_date),
    };
  },
});
