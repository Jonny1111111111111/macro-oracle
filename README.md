# Macro Oracle

**Real-time cross-asset macro intelligence powered by Pyth Network.**

Macro Oracle watches 17 institutional-grade Pyth price feeds across crypto, metals, forex and equities simultaneously — detecting macro regime shifts as they happen and generating AI-powered narrative analysis.

→ **Live Demo:** [macro-oracle.vercel.app](https://macro-oracle.vercel.app) *(deploy link here)*
→ **API Docs:** [macro-oracle-api.railway.app/docs](https://macro-oracle-api.railway.app/docs) *(deploy link here)*

---

## What It Does

Most oracle demos show one asset. Macro Oracle treats Pyth as what it actually is: **the world's only real-time institutional oracle covering crypto, forex, metals and equities simultaneously.**

The system:
1. **Streams 17 Pyth feeds** every 8 seconds via Hermes REST API
2. **Detects macro regimes** using a deterministic cross-asset signal engine
3. **Generates AI narrative** explaining *why* the regime exists using actual price data
4. **Shows regime history** — a timeline of every regime shift with its narrative
5. **Optional: Publishes to X** — one-click (with human approval)

---

## Macro Regimes Detected

| Regime | Signal Logic |
|--------|-------------|
| 🔴 **Risk-Off** | Gold ↑, Crypto ↓, Equities ↓ |
| 🟢 **Risk-On** | Crypto ↑, Equities ↑ together |
| 🟡 **Dollar Surge** | USD/JPY ↑, EUR/USD ↓, assets under pressure |
| 🔵 **Crypto Decoupling** | Crypto diverging from equities (either direction) |
| 🟠 **Commodity Cycle** | Gold ↑, Silver ↑, Oil ↑ in unison |
| ⚪ **Uncertain** | No dominant cross-asset theme |

---

## Pyth Integration

### Hermes API (off-chain)
All price data comes from the [Pyth Hermes API](https://hermes.pyth.network) — no wallet, no gas, no Rust required.

**Endpoint used:**
```
GET https://hermes.pyth.network/v2/updates/price/latest?ids[]=<feedId>&...&parsed=true
```

**Update frequency:** Every 8 seconds (configurable)

### Feed IDs Used

| Symbol | Feed ID | Class |
|--------|---------|-------|
| BTC/USD | `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` | Crypto |
| ETH/USD | `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace` | Crypto |
| SOL/USD | `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` | Crypto |
| AVAX/USD | `0x93da3352f9f1d105fdfe4971cfa80e9269ef110b2d2b9eb51a4b12f27380b8e1` | Crypto |
| PYTH/USD | `0x0bbf28e9a841a1cc788f6a361b17ca072d0ea3098a1e5df1c3922d06719579ff` | Crypto |
| XAU/USD | `0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2` | Metals |
| XAG/USD | `0xf2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e` | Metals |
| WTI/USD | `0x0e1472f3a8ee12e3c97e5ffd72dd0d37aa12b2c04c2e1d54a9c56e749b6b59e4` | Metals |
| EUR/USD | `0xa995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b` | Forex |
| GBP/USD | `0x84c2dde9633d93d1bcad84e7dc41c9d56578b7ec52fabedc1f335d673df0a7c1` | Forex |
| USD/JPY | `0xef2c98c804ba503c6a707e38be4dfbb16683775f195b091252bf24693042fd52` | Forex |
| SPY/USD | `0x2a01deaec9e51a579277b34b122399984d0bbf57e2458a7e42fecd2829867a0d` | Equities |
| QQQ/USD | `0x3b9551a68d01d954d6387aff4df1529027ffb2fee413082e509feb29cc4904fe` | Equities |
| NVDA/USD | `0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1` | Equities |

### Confidence Interval Handling (Pyth Pro)
Pyth returns a `conf` value alongside each price representing the confidence interval. Macro Oracle uses this as a **data quality weight** in the regime engine:

```python
def confidence_weight(sym, prices):
    conf_pct = prices[sym]["conf_pct"]   # conf as % of price
    weight = max(0.3, 1.0 - (conf_pct / 0.5) * 0.7)
    return min(1.0, weight)
```

A feed with a tight confidence interval (high quality) gets full weight in the regime signal. A feed with a wide interval gets downweighted. This is displayed per-asset in the UI as `HQ / MED / LOW`.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Frontend (Vite React)           │
│  ┌──────────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Regime Banner│  │ 17 Asset │  │ Narrative │  │
│  │ + Confidence │  │ Cards    │  │ Timeline  │  │
│  └──────────────┘  └──────────┘  └───────────┘  │
└────────────────────────┬────────────────────────┘
                         │ REST API (every 8-10s)
┌────────────────────────▼────────────────────────┐
│               Backend (FastAPI)                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────┐  │
│  │ Pyth Hermes │  │ Regime Engine│  │ SQLite │  │
│  │   Fetcher   │→ │ (rules-based)│→ │  DB    │  │
│  └─────────────┘  └──────┬───────┘  └────────┘  │
│                           │                      │
│                    ┌──────▼───────┐              │
│                    │ AI Narrator  │              │
│                    │(Claude/GPT)  │              │
│                    └──────────────┘              │
└────────────────────────┬────────────────────────┘
                         │
┌────────────────────────▼────────────────────────┐
│           Pyth Hermes API                        │
│      hermes.pyth.network/v2/updates/price/latest │
│      17 feeds · sub-second source data           │
└─────────────────────────────────────────────────┘
```

---

## Run Locally (One Command)

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/macro-oracle
cd macro-oracle

# Configure (optional — works without keys in demo mode)
cp apps/api/.env.example .env
# Edit .env to add ANTHROPIC_API_KEY for AI narratives

# Run everything
docker-compose up

# Open
open http://localhost:3000
```

That's it. No wallet. No gas. No Rust.

---

## Run Without Docker

**Backend:**
```bash
cd apps/api
pip install -r requirements.txt
cp .env.example .env   # add your keys
uvicorn main:app --reload --port 8000
```

**Frontend:**
```bash
cd apps/web
npm install
VITE_API_URL=http://localhost:8000 npm run dev
```

---

## API Reference

| Endpoint | Description |
|----------|-------------|
| `GET /` | Health check |
| `GET /feeds` | List all 17 configured Pyth feeds |
| `GET /prices/latest` | Latest price + confidence for all feeds |
| `GET /prices/history?symbol=BTC&limit=60` | Historical price points |
| `GET /regime/current` | Current detected regime + narrative |
| `GET /regime/history?limit=20` | Timeline of past regime changes |
| `POST /publish?approved=false` | Preview tweet text |
| `POST /publish?approved=true` | Publish to X (requires Twitter creds) |

Full interactive docs at `/docs` (Swagger UI auto-generated by FastAPI).

---

## Environment Variables

```env
# AI Narrative generation (optional — falls back to deterministic)
ANTHROPIC_API_KEY=sk-ant-...

# Twitter publishing (optional — enables "Publish to X" button)
TWITTER_API_KEY=
TWITTER_API_SECRET=
TWITTER_ACCESS_TOKEN=
TWITTER_ACCESS_SECRET=
```

The app runs fully in demo/deterministic mode with no API keys at all.

---

## Deployment

**Frontend → Vercel:**
```bash
cd apps/web
npx vercel --prod
# Set VITE_API_URL=https://your-api.railway.app
```

**Backend → Railway:**
```bash
# Connect GitHub repo to Railway
# Set root directory: apps/api
# Set start command: uvicorn main:app --host 0.0.0.0 --port $PORT
# Add environment variables in Railway dashboard
```

---

## Built With

- [Pyth Network](https://pyth.network) — price oracle data
- [FastAPI](https://fastapi.tiangolo.com) — Python backend
- [Vite + React](https://vitejs.dev) — frontend
- [Anthropic Claude](https://anthropic.com) — AI narrative generation
- [SQLite](https://sqlite.org) — regime history storage

---

## License

Apache 2.0 — see [LICENSE](./LICENSE)
