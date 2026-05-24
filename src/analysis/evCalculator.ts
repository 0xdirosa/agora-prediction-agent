export function calculateImpliedProbability(price: number): number {
  if (price <= 0 || price >= 1) {
    throw new RangeError(`Price must be in (0, 1), got ${price}`);
  }
  return price;
}

const MIN_EDGE = 0.01;

export function calculateEV(
  ourProbability: number,
  marketPrice: number,
): number {
  if (ourProbability <= 0 || ourProbability >= 1) return 0;
  if (marketPrice <= 0 || marketPrice >= 1) return 0;

  const edge = ourProbability - marketPrice;

  if (Math.abs(edge) < MIN_EDGE) {
    return 0;
  }

  const oddsIfWin = (1 / marketPrice) - 1;
  const ev = ourProbability * oddsIfWin - (1 - ourProbability);

  return ev;
}

export function isConfidentBet(ourProbability: number, marketPrice: number): boolean {
  const edge = ourProbability - marketPrice;
  return Math.abs(edge) >= MIN_EDGE;
}

export function kellyBetSize(
  bankroll: number,
  probability: number,
  marketPrice: number,
): number {
  if (bankroll <= 0) return 0;
  if (probability <= 0 || probability >= 1) return 0;
  if (marketPrice <= 0 || marketPrice >= 1) return 0;

  const b = (1 - marketPrice) / marketPrice;
  const q = 1 - probability;
  const fullKelly = (b * probability - q) / b;
  const halfKelly = fullKelly * 0.5;
  const betAmount = bankroll * halfKelly;

  return Math.max(0, Math.round(betAmount * 100) / 100);
}

export function isValueBet(ev: number, threshold = 0.0): boolean {
  return ev > threshold;
}

if (process.argv[1]?.endsWith("evCalculator.ts")) {
  console.log("=== evCalculator Test ===\n");

  const testCases = [
    { ourProb: 0.42, marketP: 0.40, desc: "42% on 40% (edge 2pp)" },
    { ourProb: 0.43, marketP: 0.40, desc: "43% on 40% (edge 3pp)" },
    { ourProb: 0.46, marketP: 0.40, desc: "46% on 40% (edge 6pp)" },
    { ourProb: 0.55, marketP: 0.40, desc: "55% on 40% (edge 15pp)" },
    { ourProb: 0.65, marketP: 0.40, desc: "65% on 40% (edge 25pp)" },
  ];

  for (const tc of testCases) {
    const ev = calculateEV(tc.ourProb, tc.marketP);
    const bet = kellyBetSize(1000, tc.ourProb, tc.marketP);
    console.log(`  ${tc.desc}: EV=${(ev * 100).toFixed(2)}¢/¢ KellyBet=$${bet.toFixed(2)}`);
  }

  console.log("\n--- MIN_EDGE=0.01 filter test ---");
  console.log(`edge=0.008 → EV=${(calculateEV(0.408, 0.40) * 100).toFixed(2)}%`);
  console.log(`edge=0.010 → EV=${(calculateEV(0.410, 0.40) * 100).toFixed(2)}%`);
  console.log(`edge=0.020 → EV=${(calculateEV(0.420, 0.40) * 100).toFixed(2)}%`);
  console.log(`edge=0.050 → EV=${(calculateEV(0.450, 0.40) * 100).toFixed(2)}%`);
}
