import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { asArray, asRecord, tauricGet } from "../lib/tauric";

/** Tauric category vocabulary from Trading-R1 tools/data/macro/common.py */
const CATEGORIES = [
  "Growth & Output",
  "Employment & Labor",
  "Inflation",
  "Treasury Yields",
  "Fed Policy & Rates",
  "Credit & Stress",
  "Consumer & Income",
  "Housing & Business",
  "Trade & Global",
  "Money Supply",
] as const;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export default defineTool({
  description: prompt`
    Latest US macro readings for one Tauric category (Growth & Output, Employment & Labor,
    Inflation, Treasury Yields, Fed Policy & Rates, Credit & Stress, Consumer & Income,
    Housing & Business, Trade & Global, Money Supply). Each series includes the newest
    value and period. Use to frame the economy before equity-level work.
  `,
  effect: "read",
  execution: "server",
  inputSchema: z.object({
    category: z.enum(CATEGORIES).describe("Macro category to read."),
  }),
  async execute({ category }) {
    const body = await tauricGet("/markets/macro/snapshot", { category });
    const series = asArray(body.data)
      .map((row) => {
        const m = asRecord(row);
        if (!m) return null;
        const s = asRecord(m.series) ?? {};
        const latest = asRecord(m.latest) ?? {};
        const period = asRecord(latest.period) ?? {};
        const unit = asRecord(s.unit) ?? {};
        const key = String(m.key ?? "").replace(/^series:/, "");
        if (num(latest.value) === null) return null;
        return {
          series: key,
          name: str(s.name),
          period: str(period.label),
          period_end: str(period.end),
          value: num(latest.value),
          unit: str(unit.name ?? unit.code ?? unit.kind),
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    if (series.length === 0) {
      throw new Error(`no ${category} readings available right now`);
    }

    return { category, series };
  },
});
