import axios from "axios";

const GAMMA_API = "https://gamma-api.polymarket.com";
const CLOB_API = "https://clob.polymarket.com";

export interface GammaMarket {
  conditionId: string;
  slug: string;
  title: string;
  description: string;
  outcomes: string[];
  outcomePrices: string[];
  volume: string;
  liquidity: string;
  endDate: string;
  active: boolean;
  closed: boolean;
  negRisk: boolean;
  tags: string[];
}

export interface MarketPrices {
  yes: number;
  no: number;
  spread: number;
  mid: number;
}

export interface OrderbookLevel {
  price: number;
  size: number;
}

export interface Orderbook {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
}

function parseArr(val: any): any[] {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") try { return JSON.parse(val); } catch { return []; }
  return [];
}

function normalize(raw: any): GammaMarket {
  const outcomes = parseArr(raw.outcomes ?? raw.outcomeTokens);
  const prices = parseArr(raw.outcomePrices ?? raw.prices);
  return {
    conditionId: raw.conditionId ?? raw.condition_id ?? "",
    slug: raw.slug ?? "",
    title: raw.title ?? raw.question ?? "Untitled",
    description: raw.description ?? "",
    outcomes: outcomes.map((o: any) => (typeof o === "string" ? o : o.outcome ?? o.name ?? "")),
    outcomePrices: prices.map((p: any) => (typeof p === "string" ? p : String(p))),
    volume: raw.volume ?? raw.volumeNum ?? "0",
    liquidity: raw.liquidity ?? "0",
    endDate: raw.endDate ?? raw.end_date ?? "",
    active: raw.closed !== true && raw.active !== false,
    closed: raw.closed === true,
    negRisk: raw.negRisk ?? raw.neg_risk ?? false,
    tags: parseArr(raw.tags),
  };
}

export async function fetchActiveMarkets(tag?: string, limit = 50): Promise<GammaMarket[]> {
  const params: Record<string, string | number | boolean> = {
    limit: Math.min(limit, 100),
    closed: false,
    archived: false,
  };
  if (tag) params.tag = tag;

  const { data } = await axios.get(`${GAMMA_API}/markets`, { params });
  return data.map(normalize);
}

export async function fetchMarketById(conditionId: string): Promise<GammaMarket | null> {
  try {
    const { data } = await axios.get(`${GAMMA_API}/markets`, {
      params: { condition_id: conditionId, limit: 1 },
    });
    if (!data.length) return null;
    return normalize(data[0]);
  } catch {
    return null;
  }
}

export async function getMarketPrices(conditionId: string): Promise<MarketPrices | null> {
  try {
    const market = await fetchMarketById(conditionId);
    if (!market) return null;

    const prices = market.outcomePrices.map((p) => parseFloat(p));
    const yes = prices[0] ?? 0.5;
    const no = prices[1] ?? 1 - yes;

    return {
      yes,
      no,
      spread: Math.abs(yes - no),
      mid: (yes + no) / 2,
    };
  } catch {
    return null;
  }
}

export async function fetchOrderbook(tokenId: string): Promise<Orderbook> {
  const { data } = await axios.get(`${CLOB_API}/book`, {
    params: { token_id: tokenId },
  });

  const bids: OrderbookLevel[] = (data.bids ?? []).map((b: any) => ({
    price: parseFloat(b.price),
    size: parseFloat(b.size),
  }));

  const asks: OrderbookLevel[] = (data.asks ?? []).map((a: any) => ({
    price: parseFloat(a.price),
    size: parseFloat(a.size),
  }));

  return { bids, asks };
}

export async function getMidPrice(tokenId: string): Promise<number> {
  const book = await fetchOrderbook(tokenId);
  const bestBid = book.bids.length > 0 ? book.bids[0].price : 0;
  const bestAsk = book.asks.length > 0 ? book.asks[0].price : 0;
  if (bestBid === 0 && bestAsk === 0) return 0.5;
  if (bestBid === 0) return bestAsk;
  if (bestAsk === 0) return bestBid;
  return (bestBid + bestAsk) / 2;
}

// ── Inline test ──
if (process.argv[1]?.endsWith("polymarketClient.ts")) {
  console.log("=== polymarketClient Test ===");
  const test = async () => {
    const markets = await fetchActiveMarkets("crypto", 3);
    console.log(`Fetched ${markets.length} markets`);
    for (const m of markets) {
      console.log(`  ${m.title} | prices: ${m.outcomePrices.join(", ")}`);
    }
    const prices = markets[0] ? await getMarketPrices(markets[0].conditionId) : null;
    console.log(`Prices:`, prices);
  };
  test().catch(console.error);
}
