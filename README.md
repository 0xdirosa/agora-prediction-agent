# Prediction Market Trader Agent

> Agora Agents Hackathon · Canteen × Circle × Arc

AI agent yang secara otonom menganalisis prediction markets, menemukan peluang +EV menggunakan LLM reasoning, dan mengeksekusi bets via Circle Developer-Controlled Wallets di Arc testnet.

## What the AI Decides (Autonomous)

Ini yang agent putuskan sendiri — bukan rule-based automation:

- Market mana yang underpriced berdasarkan LLM analysis
- Estimasi probabilitas vs market consensus (Groq Llama 3.1)
- Bet size optimal via Kelly Criterion
- YES vs NO berdasarkan reasoning
- Auto-skip jika EV di bawah threshold 10%

## Why Arc

- **Sub-second finality** — keputusan agent langsung settled
- **~$0.01 per transaksi** — high-frequency scanning ekonomis
- **USDC-native** — tidak perlu volatile gas token

## Circle Tools Used

- **Developer-Controlled Wallets** — autonomous key management untuk agent yang beroperasi 24/7 tanpa human intervention
- **Arc Testnet** — settlement layer
- **ERC-8004** — Agent ID #19687 registered on-chain

## Architecture

```
Polymarket API
     ↓
Market Scanner (50 markets/cycle)
     ↓
Groq Llama 3.1 (probability estimation + reasoning)
     ↓
EV Calculator + Kelly Criterion (bet sizing)
     ↓
Decision Engine (EXECUTE / SKIP)
     ↓
Circle Developer-Controlled Wallet
     ↓
Arc Testnet (ERC-8004 Agent #19687)
```

## Results (Live Testnet)

| Metric | Value |
|--------|-------|
| Markets scanned per cycle | 50 |
| Avg +EV opportunities | 14/50 (28%) |
| Agent registered | Arc Testnet #19687 |
| TX | `0x212fad...f373f` |
| Wallet | `0x9f5019...20ad5` |

## Setup

### Prerequisites

- Node.js 22+
- [Circle API Key](https://console.circle.com) (console.circle.com)
- [Groq API Key](https://console.groq.com) (console.groq.com)

### Install

```bash
git clone <repo-url>
cd agora-prediction-agent
npm install
cp .env.example .env
```

Edit `.env` — isi `CIRCLE_API_KEY` dan `GROQ_API_KEY`:

```bash
nano .env
```

### Setup Wallet (pertama kali)

```bash
node scripts/generate-entity-secret.mjs
node scripts/setup-wallet.mjs
node scripts/register-agent.mjs
```

### Run

```bash
# Terminal dashboard + agent loop
npm start

# Web dashboard
npm run server
# Buka http://localhost:3000
```

## Project Structure

```
src/
  agent/          Core agent logic + decision engine
  analysis/       EV calculator + Groq probability estimation
  markets/        Polymarket API client
  wallet/         Circle wallet integration
  arc/            Arc blockchain client + constants
  server.ts       Express API dashboard server
  log-stream.ts   SSE log capture for dashboard
scripts/
  generate-entity-secret.mjs
  setup-wallet.mjs
  register-agent.mjs
dashboard/
  index.html      Single-file dark theme web dashboard
```
