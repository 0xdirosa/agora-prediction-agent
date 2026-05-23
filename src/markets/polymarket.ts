import axios from "axios";

export interface PolymarketOutcome {
  price: string;
  outcome: string;
}

export interface PolymarketMarket {
  conditionId: string;
  slug: string;
  title: string;
  description: string;
  outcomes: string[];
  outcomePrices: string[];
  volume: number;
  liquidity: number;
  endDate: string;
  active: boolean;
  closed: boolean;
  negRisk: boolean;
}

export interface PolymarketOrder {
  id: string;
  price: string;
  size: string;
  side: "BUY" | "SELL";
  tokenId: string;
}

export interface CLOBOrderPayload {
  tokenID: string;
  price: string;
  size: string;
  side: "BUY" | "SELL";
  feeLimitBps: number;
  signature: string;
  owner: string;
  salt: string;
  expiration: string;
  negRisk: boolean;
}

const CLOB_API = "https://clob.polymarket.com";
const GAMMA_API = "https://gamma-api.polymarket.com";

export async function listMarkets(tag?: string, limit = 50): Promise<PolymarketMarket[]> {
  const params: Record<string, string | number | boolean> = {
    limit: Math.min(limit, 100),
    closed: false,
    archived: false,
  };
  if (tag) params.tag = tag;

  const { data } = await axios.get(`${GAMMA_API}/markets`, { params });
  return data.map(normalizeMarket);
}

export async function searchMarkets(query: string): Promise<PolymarketMarket[]> {
  const { data } = await axios.get(`${GAMMA_API}/markets`, {
    params: { limit: 25, closed: false, archived: false, title: query } as Record<string, string | number | boolean>,
  });
  return data.map(normalizeMarket);
}

export async function getMarketBySlug(slug: string): Promise<PolymarketMarket | null> {
  try {
    const { data } = await axios.get(`${GAMMA_API}/events`, {
      params: { slug, closed: false },
    });
    if (!data.length) return null;
    const event = data[0];
    const markets = event.markets ?? [];
    return markets.length > 0 ? normalizeMarket(markets[0]) : null;
  } catch {
    return null;
  }
}

export async function getMarketByConditionId(conditionId: string): Promise<PolymarketMarket | null> {
  try {
    const { data } = await axios.get(`${GAMMA_API}/markets`, {
      params: { condition_id: conditionId, limit: 1 },
    });
    if (!data.length) return null;
    return normalizeMarket(data[0]);
  } catch {
    return null;
  }
}

export async function getOrderbook(tokenId: string): Promise<{ bids: PolymarketOrder[]; asks: PolymarketOrder[] }> {
  const { data } = await axios.get(`${CLOB_API}/book`, {
    params: { token_id: tokenId },
  });
  return data;
}

export async function getMidPrice(tokenId: string): Promise<number> {
  const book = await getOrderbook(tokenId);
  const bestBid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const bestAsk = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 0;
  if (bestBid === 0 && bestAsk === 0) return 0.5;
  if (bestBid === 0) return bestAsk;
  if (bestAsk === 0) return bestBid;
  return (bestBid + bestAsk) / 2;
}

export async function getTokenId(conditionId: string, outcome: string): Promise<string> {
  const { data } = await axios.get(`${CLOB_API}/neg-risk/neg-risk-token-id`, {
    params: { condition_id: conditionId, outcome },
  });
  return data.token_id ?? data;
}

export function normalizeMarket(raw: any): PolymarketMarket {
  const outcomes = raw.outcomes ?? raw.outcomeTokens ?? [];
  const prices = raw.outcomePrices ?? raw.prices ?? [];

  return {
    conditionId: raw.conditionId ?? raw.condition_id ?? "",
    slug: raw.slug ?? "",
    title: raw.title ?? raw.question ?? "Untitled Market",
    description: raw.description ?? "",
    outcomes: outcomes.map((o: any) => (typeof o === "string" ? o : o.outcome ?? o.name ?? "")),
    outcomePrices: prices.map((p: any) => (typeof p === "string" ? p : String(p))),
    volume: parseFloat(raw.volume ?? raw.volumeNum ?? "0"),
    liquidity: parseFloat(raw.liquidity ?? "0"),
    endDate: raw.endDate ?? raw.end_date ?? "",
    active: raw.closed !== true && raw.active !== false,
    closed: raw.closed === true,
    negRisk: raw.negRisk ?? raw.neg_risk ?? false,
  };
}

export function deriveTokenId(conditionId: string, outcomeIndex: number): string {
  const hash = simpleHash(`${conditionId}:${outcomeIndex}`);
  return hash;
}

function simpleHash(input: string): string {
  let hash = 0n;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5n) - hash + BigInt(input.charCodeAt(i));
    hash &= 0xffffffffffffffffn;
  }
  return `0x${hash.toString(16).padStart(64, "0")}`;
}
