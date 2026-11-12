import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";

export default defineTool({
  description: prompt`
    Recall a recommendation previously stored with record_recommendation in this
    session. Pass a symbol to fetch that name, or omit it to fetch the latest one.
  `,
  effect: "read",
  execution: "server",
  inputSchema: z.object({
    symbol: z.string().trim().min(1).max(32).optional(),
  }),
  async execute({ symbol }, ctx) {
    if (symbol) {
      const key = `recommendation:${ctx.session.id}:${symbol.toUpperCase()}`;
      const record = await ctx.host.kv.get(key);
      if (!record) {
        return { found: false as const, symbol: symbol.toUpperCase() };
      }
      return { found: true as const, record };
    }

    const latest = await ctx.host.kv.get(`recommendation:latest:${ctx.session.id}`);
    if (!latest || typeof latest !== "object" || latest === null || !("key" in latest)) {
      return { found: false as const, symbol: null };
    }
    const key = String((latest as { key: string }).key);
    const record = await ctx.host.kv.get(key);
    if (!record) return { found: false as const, symbol: null };
    return { found: true as const, record };
  },
});
