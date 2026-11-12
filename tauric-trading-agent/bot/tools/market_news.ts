import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { asArray, asRecord, tauricGet } from "../lib/tauric";
import { resolveSymbol } from "../lib/symbols";

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function article(raw: Record<string, unknown>, index: number) {
  return {
    source: index,
    headline: str(raw.headline ?? raw.title),
    publisher: str(raw.publisher ?? raw.source),
    published: str(raw.published ?? raw.published_at ?? raw.time),
    time_basis: str(raw.time_basis),
    url: str(raw.url ?? raw.link),
    summary: str(raw.summary ?? raw.snippet),
    sentiment: str(raw.sentiment),
    impact: str(raw.impact),
    event_types: asArray(raw.event_types ?? raw.events)
      .map((e) => (typeof e === "string" ? e : str(asRecord(e)?.type)))
      .filter((e): e is string => Boolean(e)),
  };
}

export default defineTool({
  description: prompt`
    Finance news from Tauric's store: latest market news, one security's news
    (symbol), or a topic search (query). Each item includes headline, publisher,
    time, link, summary, sentiment, impact, and a source number [N] for citations.
  `,
  effect: "read",
  execution: "server",
  inputSchema: z.object({
    symbol: z.string().trim().min(1).optional().describe("Narrow to one security."),
    query: z.string().trim().min(2).max(120).optional().describe("Topic search."),
    sentiment: z.enum(["bullish", "bearish", "mixed", "neutral"]).optional(),
    limit: z.number().int().min(1).max(25).default(10),
  }),
  async execute({ symbol, query, sentiment, limit }) {
    let instrument: string | undefined;
    if (symbol) {
      const inst = resolveSymbol(symbol);
      instrument = inst.key.startsWith("security:") ? inst.key : `security:${inst.label}`;
    }

    const params = {
      instrument,
      sentiment,
      limit: Math.min(limit * 2, 50),
      ...(query ? {} : { collapse: "story" }),
    };

    const body = query
      ? await tauricGet("/news/search", { q: query, ...params })
      : await tauricGet("/news", params);

    const rows = asArray(body.data);
    const items = rows
      .map((row) => {
        const rec = asRecord(row);
        if (!rec) return null;
        const nested = asRecord(rec.article);
        return nested ?? rec;
      })
      .filter((row): row is Record<string, unknown> => Boolean(row))
      .slice(0, limit)
      .map((row, i) => article(row, i + 1));

    if (items.length === 0) {
      const scope = symbol ? ` for '${symbol}'` : "";
      const matched = query ? ` matched ${JSON.stringify(query)}` : "";
      throw new Error(`no news${matched}${scope}`);
    }

    return {
      symbol: symbol ?? null,
      query: query ?? null,
      items,
    };
  },
});
