import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY ?? "" });

async function analyzeMarketWithGroq(
  marketQuestion: string,
  marketPrice: number,
): Promise<{ ourProbability: number; reasoning: string }> {
  const prompt = `
Kamu adalah analyst prediction market yang expert.

Market question: "${marketQuestion}"
Current market price (implied probability): ${(marketPrice * 100).toFixed(1)}%

Tugasmu:
1. Analisis apakah market price ini wajar berdasarkan pengetahuanmu
2. Estimasi probabilitas menurutmu (0.0 - 1.0)
3. Beri reasoning singkat (max 2 kalimat)

PENTING:
- Jangan terlalu jauh dari market price (max ±15 percentage points)
- Jika tidak punya informasi relevan, kembalikan market price apa adanya
- Pasar Polymarket relatif efisien

Jawab HANYA dalam format JSON:
{
  "ourProbability": 0.XX,
  "reasoning": "alasan singkat"
}
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

  let rawProb = result.ourProbability ?? marketPrice;
  const absMin = Math.max(0.001, marketPrice - 0.15);
  const absMax = Math.min(0.999, marketPrice + 0.15);
  const relMin = marketPrice / 5;
  const relMax = marketPrice * 5;
  const effectiveMin = Math.max(absMin, relMin);
  const effectiveMax = Math.min(absMax, relMax);
  rawProb = Math.max(effectiveMin, Math.min(effectiveMax, rawProb));

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
    console.log(`  [Groq] probability=${(result.ourProbability * 100).toFixed(1)}%, reasoning="${result.reasoning}"`);
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
