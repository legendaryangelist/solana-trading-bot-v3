import { defineEval } from "@grok/agent-sdk/evals";

export default defineEval({
  tags: ["smoke"],
  description:
    "Records a five-tier Trading-R1 recommendation without requiring live Tauric data.",
  async test(t) {
    await t.send(
      [
        "Do not call any market data tools.",
        "Call record_recommendation for symbol DEMO with rating hold.",
        "thesis: Smoke-test thesis for the Tauric trading agent scaffold;",
        "evidence is simulated and this is not a real view.",
        "catalysts: [none]; risks: [illiquid demo name].",
        "Then confirm the stored rating in one short sentence.",
      ].join(" "),
    );
    t.succeeded();
    t.calledTool("record_recommendation", {
      input: {
        symbol: "DEMO",
        rating: "hold",
      },
    });
    t.notCalledTool("market_quotes");
    t.notCalledTool("equity_reference");
  },
});
