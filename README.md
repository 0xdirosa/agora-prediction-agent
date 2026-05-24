# Agora Prediction Agent

> Agora Agents Hackathon · Canteen × Circle × Arc

Autonomous AI agent that scans Polymarket, estimates probabilities via Groq LLM, computes expected value, and records onchain analysis via ERC-8183 job lifecycle + ERC-8004 reputation/validation on Arc testnet.

## Architecture

```
Polymarket Gamma API
      ↓ (fetch 50 markets)
Market Scanner (vol > $1K, price 8%-92%)
      ↓
Groq Llama 3.1 (probability estimation, temperature 0.5)
      ↓
EV Calculator + Kelly Criterion (MIN_EDGE = 1%, half-Kelly)
      ↓
Decision Engine (YES/NO, bet size)
      ↓
┌─────────────────────────────────────────────────┐
│              ONCHAIN LIFECYCLE                   │
│                                                  │
│  1. ERC-8183 Job                                 │
│     createJob → setBudget → approve USDC →       │
│     fund → submit deliverable → complete         │
│                                                  │
│  2. ERC-8004 Reputation (validator wallet)       │
│     giveFeedback(agentId, score=100, tag)        │
│                                                  │
│  3. ERC-8004 Validation                          │
│     owner: validationRequest(validator, agentId) │
│     validator: validationResponse(approved=100)  │
│                                                  │
│  4. Market Resolution (next cycle)               │
│     fetch resolved market → compare prediction   │
│     → giveFeedback(correct=100 / wrong=0)        │
└─────────────────────────────────────────────────┘
      ↓
Dashboard (Express + real-time SSE)
      7 metrics · decision feed · live logs
```

## Key Features

| Feature | Detail |
|---------|--------|
| **AI Analysis** | Groq Llama 3.1-8b, temperature 0.5, adjustment-based probability |
| **EV Calculation** | Standard formula `EV = ourProb * odds - (1-ourProb)`, MIN_EDGE = 1% |
| **Bet Sizing** | Half-Kelly Criterion, capped at 10% of bankroll |
| **ERC-8183 Jobs** | Full lifecycle: create → setBudget → approve → fund → submit → complete |
| **ERC-8004 Reputation** | Validator wallet gives feedback (score=100 per bet) + accuracy tracking |
| **ERC-8004 Validation** | Owner requests → validator responds (two-step) |
| **Market Resolution** | Auto-check resolved markets, update reputation with accuracy score |
| **Persistence** | Bets + cycles saved to `data/` JSON files, survive restarts |
| **Dashboard** | 7 metrics, SSE log stream, job links to explorer, resolution badges |

## Smart Contracts (Arc Testnet)

| Contract | Address |
|----------|---------|
| ERC-8004 IdentityRegistry | `0x8004A8...BD9e` |
| ERC-8004 ReputationRegistry | `0x8004B6...8713` |
| ERC-8004 ValidationRegistry | `0x8004Cb...4272` |
| ERC-8183 AgenticCommerce | `0x0747EE...e4583` |
| USDC (ERC-20) | `0x360000...0000` |

## Agent Identity

- **Agent ID**: #19687
- **Owner Wallet**: `0x9f5019...20ad5`
- **Validator Wallet**: `0x2762e2...3681` (separate SCA wallet for ERC-8004 compliance)

## Results (Live Testnet)

| Metric | Value |
|--------|-------|
| Markets scanned per cycle | 50 |
| ERC-8183 jobs created | 6+ (IDs: 40317, 40321, 40323, 40359, 40377, 40379, ...) |
| Reputation feedbacks | 6+ (score=100 each) |
| Validation requests/responses | 6+ (all approved) |
| Bankroll | 100 USDC (circular flow, never spent) |
| Gas | Sponsored by Circle Gas Station |

## Setup

### Prerequisites

- Node.js 22+
- [Circle API Key](https://console.circle.com)
- [Groq API Key](https://console.groq.com)

### Install

```bash
git clone <repo-url>
cd agora-prediction-agent
npm install
cp .env.example .env
```

Edit `.env` — fill `CIRCLE_API_KEY` and `GROQ_API_KEY`:

```bash
nano .env
```

### Wallet Setup (first time)

```bash
# Generate entity secret + create wallet
node scripts/generate-entity-secret.mjs
node scripts/setup-wallet.mjs

# Register agent identity on ERC-8004
node scripts/register-agent.mjs

# Create validator wallet for reputation
node scripts/create-validator-wallet.mjs
```

### Run

```bash
# Single analysis cycle
npm start -- --once

# Autonomous loop
npm start

# Web dashboard
npm run server
# Open http://localhost:3000
```

## API Endpoints

| Route | Description |
|-------|-------------|
| `GET /api/status` | Agent status + cycle info |
| `GET /api/wallet` | Wallet balance + Arc network |
| `GET /api/metrics` | Performance metrics (incl. accuracy) |
| `GET /api/decisions` | Last 20 bet decisions |
| `GET /api/reputation` | Agent ID + validator address |
| `GET /api/resolution` | Accuracy stats (correct/total) |
| `GET /api/logs` | Last 200 log entries |
| `GET /api/logs/stream` | SSE real-time log stream |
| `POST /api/start` | Run one analysis cycle |
| `POST /api/stop` | Stop agent loop |
| `POST /api/resolve` | Trigger market resolution check |

## Project Structure

```
src/
  agent/
    predictionAgent.ts   Core agent: scan → evaluate → execute → resolve
    types.ts             BetRecord, MarketOpportunity, CycleSummary
  analysis/
    sentimentAnalyzer.ts Groq LLM probability estimation (temperature 0.5)
    evCalculator.ts      EV formula, Kelly Criterion, isValueBet
  markets/
    polymarketClient.ts  Gamma API + CLOB API client
  wallet/
    circleWallet.ts      Circle Developer-Controlled Wallets SDK
  jobs/
    erc8183Client.ts     ERC-8183 job lifecycle (create → fund → submit → complete)
    agentIdentity.ts     ERC-8004 identity registration + lookup
    reputationClient.ts  ERC-8004 giveFeedback + score queries
    validationClient.ts  ERC-8004 validation request + response
    marketResolver.ts    Check resolved markets, update reputation by accuracy
    persistence.ts       Save/load bets + cycles to JSON files
  arc/
    constants.ts         Contract addresses, chain config, viem client
    arcClient.ts         Low-level Arc RPC helpers
    agentRegistry.ts     Full ERC-8004 registration (identity + reputation)
  server.ts              Express dashboard (API + static files)
  log-stream.ts          Console capture + SSE streaming
dashboard/
  index.html             Dark-theme dashboard (7 metrics, log stream, decision feed)
scripts/
  generate-entity-secret.mjs
  setup-wallet.mjs
  register-agent.mjs
  create-validator-wallet.mjs
  verify-setup.mjs
```

## Tech Stack

- **Runtime**: Node.js + TypeScript (tsx)
- **AI**: Groq SDK (llama-3.1-8b-instant)
- **Blockchain**: viem + Arc Testnet (chainId 5042002)
- **Wallet**: `@circle-fin/developer-controlled-wallets`
- **API**: Express (dashboard) + Polymarket Gamma/CLOB
- **Standards**: ERC-8004 (Identity/Reputation/Validation) + ERC-8183 (Job Settlement)
