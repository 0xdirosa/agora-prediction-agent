import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { BetRecord, CycleSummary } from "../agent/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../../data");
const BETS_FILE = resolve(DATA_DIR, "bets.json");
const CYCLES_FILE = resolve(DATA_DIR, "cycles.json");

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function saveBets(bets: BetRecord[]): void {
  ensureDir();
  writeFileSync(BETS_FILE, JSON.stringify(bets, null, 2), "utf-8");
}

export function loadBets(): BetRecord[] {
  ensureDir();
  if (!existsSync(BETS_FILE)) return [];
  try {
    const data = readFileSync(BETS_FILE, "utf-8");
    return JSON.parse(data) as BetRecord[];
  } catch {
    return [];
  }
}

export function saveCycles(cycles: CycleSummary[]): void {
  ensureDir();
  writeFileSync(CYCLES_FILE, JSON.stringify(cycles, null, 2), "utf-8");
}

export function loadCycles(): CycleSummary[] {
  ensureDir();
  if (!existsSync(CYCLES_FILE)) return [];
  try {
    const data = readFileSync(CYCLES_FILE, "utf-8");
    return JSON.parse(data) as CycleSummary[];
  } catch {
    return [];
  }
}
