import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";

const Rating = z.enum(["strong_buy", "buy", "hold", "sell", "strong_sell"]);

export type Recommendation = {
  symbol: string;
  rating: z.infer<typeof Rating>;
  thesis: string;
  catalysts: string[];
  risks: string[];
  as_of: string;
  session_id: string;
};

export default defineTool({
  description: prompt`
    Persist a structured trading recommendation for a symbol on the five-tier
    Trading-R1 scale (strong_buy, buy, hold, sell, strong_sell). Call only after
    you have grounded the view in tool evidence. Stores the thesis in session
    memory so a later turn can recall it. Does not place trades.
  `,
  effect: "idempotent",
  execution: "server",
  inputSchema: z.object({
    symbol: z.string().trim().min(1).max(32),
    rating: Rating,
    thesis: z.string().trim().min(20).max(2000),
    catalysts: z.array(z.string().trim().min(1)).max(8).default([]),
    risks: z.array(z.string().trim().min(1)).max(8).default([]),
  }),
  async execute({ symbol, rating, thesis, catalysts, risks }, ctx) {
    const asOf = new Date().toISOString();
    const key = `recommendation:${ctx.session.id}:${symbol.toUpperCase()}`;
    const record: Recommendation = {
      symbol: symbol.toUpperCase(),
      rating,
      thesis,
      catalysts,
      risks,
      as_of: asOf,
      session_id: ctx.session.id,
    };
    await ctx.host.kv.put(key, record);
    await ctx.host.kv.put(`recommendation:latest:${ctx.session.id}`, {
      key,
      symbol: record.symbol,
      rating,
      as_of: asOf,
    });
    return {
      stored: true,
      key,
      symbol: record.symbol,
      rating,
      as_of: asOf,
      disclaimer:
        "Research and education only — not investment advice; no order was placed.",
    };
  },
});
