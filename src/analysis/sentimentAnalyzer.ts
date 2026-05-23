import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY ?? "" });

async function analyzeMarketWithGroq(
  marketQuestion: string,
  marketPrice: number,
): Promise<{ ourProbability: number; reasoning: string }> {
  const prompt = `
You are a prediction market analyst.

Market: "${marketQuestion}"
Current market price: ${(marketPrice * 100).toFixed(2)}%

The market price already reflects crowd wisdom.
Your job: decide if this market is slightly mispriced.

Respond ONLY with valid JSON, no other text:
{
  "adjustment": <number between -0.05 and 0.05>,
  "reasoning": "<one sentence max>"
}

Rules:
- adjustment = 0.0 means you agree with market price
- adjustment = +0.02 means you think true probability
  is 2 percentage points HIGHER than market price
- adjustment = -0.02 means 2pp LOWER
- Maximum adjustment: ±0.05 (5 percentage points)
- For sports longshots under 2%: adjustment range is
  only -0.01 to +0.01
- If you have no specific knowledge: use 0.0
`;

  const response = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
    max_tokens: 200,
    response_format: { type: "json_object" },
  });

  const result = JSON.parse(
    response.choices[0]?.message?.content ?? "{}",
  );

  const adjustment = result.adjustment ?? 0;

  let rawProb = marketPrice + adjustment;
  rawProb = Math.max(0.001, Math.min(0.999, rawProb));

  console.log('[Groq adjustment]', {
    question: marketQuestion.substring(0, 60),
    marketPrice: +(marketPrice * 100).toFixed(2),
    adjustment: +adjustment.toFixed(4),
    ourProb: +(rawProb * 100).toFixed(2),
  });

  return {
    ourProbability: rawProb,
    reasoning: result.reasoning ?? "No reasoning provided",
  };
}

export async function estimateProbability(
  marketQuestion: string,
  marketPrice: number,
): Promise<{ probability: number; reasoning: string }> {
  if (!process.env.GROQ_API_KEY) {
    return {
      probability: marketPrice,
      reasoning: "No Groq key — using market price as-is",
    };
  }

  try {
    const result = await analyzeMarketWithGroq(marketQuestion, marketPrice);
    console.log(`  [Groq] prob=${(result.ourProbability * 100).toFixed(1)}%, reasoning="${result.reasoning}"`);
    return {
      probability: result.ourProbability,
      reasoning: result.reasoning,
    };
  } catch (err) {
    console.error("  [Groq] error:", err instanceof Error ? err.message : String(err));
    return {
      probability: marketPrice,
      reasoning: "Groq error — fallback to market price",
    };
  }
}
