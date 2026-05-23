import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY ?? "" });

async function analyzeMarketWithGroq(
  marketQuestion: string,
  marketPrice: number,
): Promise<{ ourProbability: number; reasoning: string }> {
  const prompt = `
You are a prediction market analyst evaluating: "${marketQuestion}"

Current market price: ${(marketPrice * 100).toFixed(1)}%

Think step by step:
1. What is this market asking?
2. Based on your knowledge, is the current price too high, too low, or about right?
3. What specific factors support a higher or lower probability?
4. Estimate the TRUE probability as a single number.

Rules:
- If you AGREE with the market or have NO specific knowledge: 
  return EXACTLY ${marketPrice.toFixed(4)} (the market price)
- If you DISAGREE: maximum deviation is ±10 percentage points
  (e.g., from 50% to max 60% or min 40%)
- Be precise — return probabilities like 0.43, 0.51, 0.62 not 0.5, 0.55
- For sports/pop culture markets: trust the market more (smaller deviations)

Respond with valid JSON ONLY:
{
  "probability": <number between 0.0 and 1.0>,
  "reasoning": "<one sentence>"
}
`;

  const response = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.5,
    max_tokens: 200,
    response_format: { type: "json_object" },
  });

  const result = JSON.parse(
    response.choices[0]?.message?.content ?? "{}",
  );

  let rawProb = result.probability ?? marketPrice;

  const maxProb = Math.min(0.999, marketPrice + 0.10);
  const minProb = Math.max(0.001, marketPrice - 0.10);
  rawProb = Math.max(minProb, Math.min(maxProb, rawProb));

  const edge = rawProb - marketPrice;
  console.log('[Groq probability]', {
    question: marketQuestion.substring(0, 60),
    marketPrice: +(marketPrice * 100).toFixed(1),
    ourProb: +(rawProb * 100).toFixed(1),
    edgePp: +(edge * 100).toFixed(2),
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
    console.log(`  [Groq] prob=${(result.ourProbability * 100).toFixed(1)}% edge=${((result.ourProbability - marketPrice) * 100).toFixed(2)}pp reasoning="${result.reasoning}"`);
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
