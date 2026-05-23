export function calculateImpliedProbability(price: number): number {
  if (price <= 0 || price >= 1) {
    throw new RangeError(`Price must be in (0, 1), got ${price}`);
  }
  return price;
}

const MAX_EV = 2.0; // 200% cap — prevents extreme longshot overestimation

export function calculateEV(
  ourProbability: number,
  marketPrice: number,
): number {
  if (ourProbability <= 0 || ourProbability >= 1) return 0;
  if (marketPrice <= 0 || marketPrice >= 1) return 0;
  const ev = Math.min(MAX_EV, (ourProbability - marketPrice) / marketPrice);
  console.log(`  [EV_DEBUG] ourProb=${ourProbability.toFixed(4)}, marketPrice=${marketPrice.toFixed(4)}, rawEv=${((ourProbability - marketPrice) / marketPrice * 100).toFixed(2)}%, cappedEv=${(ev * 100).toFixed(2)}%`);
  return ev;
}

export function isConfidentBet(ourProbability: number, marketPrice: number): boolean {
  // For extreme longshots (market < 5%), require probability to be at least 2× market price
  if (marketPrice < 0.05 && ourProbability < marketPrice * 2) return false;
  return true;
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

export function isValueBet(ev: number, threshold = 0.05): boolean {
  return ev > threshold;
}

// ── Inline test ──
if (process.argv[1]?.endsWith("evCalculator.ts")) {
  console.log("=== evCalculator Test ===");

  const price = 0.65;
  const implied = calculateImpliedProbability(price);
  console.log(`Implied probability of ${price}: ${implied}`);

  const ourProb = 0.8;
  const marketP = 0.6;
  const ev = calculateEV(ourProb, marketP);
  console.log(`EV(ourProb=${ourProb}, marketPrice=${marketP}): ${ev}`);

  const bankroll = 1000;
  const betSize = kellyBetSize(bankroll, ourProb, marketP);
  console.log(`Kelly bet size (bankroll=${bankroll}, ev=${ev}, prob=${ourProb}): $${betSize}`);

  const valBet = isValueBet(ev, 0.05);
  console.log(`Is value bet (ev=${ev}, threshold=0.05): ${valBet}`);

  const noVal = isValueBet(0.02, 0.05);
  console.log(`Is value bet (ev=0.02): ${noVal}`);
}
