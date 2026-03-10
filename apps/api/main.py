"""
Macro Oracle — FastAPI Backend
Powered by Pyth Network Hermes API
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import asyncio
import aiohttp
import time
import math
from typing import Optional
from contextlib import asynccontextmanager
from db import init_db, save_regime, get_regime_history
from regime import detect_regime
from narrator import generate_narrative

# ── Feed definitions (mirrored from shared/feeds.ts) ──────────────────────────
FEEDS = [
    {"sym": "BTC",     "id": "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", "class": "crypto"},
    {"sym": "ETH",     "id": "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", "class": "crypto"},
    {"sym": "SOL",     "id": "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", "class": "crypto"},
    {"sym": "AVAX",    "id": "0x93da3352f9f1d105fdfe4971cfa80e9269ef110b2d2b9eb51a4b12f27380b8e1", "class": "crypto"},
    {"sym": "PYTH",    "id": "0x0bbf28e9a841a1cc788f6a361b17ca072d0ea3098a1e5df1c3922d06719579ff", "class": "crypto"},
    {"sym": "XAU",     "id": "0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2", "class": "metals"},
    {"sym": "XAG",     "id": "0xf2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e", "class": "metals"},
    {"sym": "WTI",     "id": "0x0e1472f3a8ee12e3c97e5ffd72dd0d37aa12b2c04c2e1d54a9c56e749b6b59e4", "class": "metals"},
    {"sym": "NGAS",    "id": "0xa0cf45057a91c5b3034efc3b5f7c83bada35e793d57ea50f1e1d65a4c8499fd0", "class": "metals"},
    {"sym": "EUR/USD", "id": "0xa995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b", "class": "forex"},
    {"sym": "GBP/USD", "id": "0x84c2dde9633d93d1bcad84e7dc41c9d56578b7ec52fabedc1f335d673df0a7c1", "class": "forex"},
    {"sym": "USD/JPY", "id": "0xef2c98c804ba503c6a707e38be4dfbb16683775f195b091252bf24693042fd52", "class": "forex"},
    {"sym": "USD/CNH", "id": "0xeef52e09c878ad41f6a81803e3ba6e6fc37b04ed9cc5d7c02f7e24e41be0d421", "class": "forex"},
    {"sym": "SPY",     "id": "0x2a01deaec9e51a579277b34b122399984d0bbf57e2458a7e42fecd2829867a0d", "class": "equities"},
    {"sym": "QQQ",     "id": "0x3b9551a68d01d954d6387aff4df1529027ffb2fee413082e509feb29cc4904fe", "class": "equities"},
    {"sym": "NVDA",    "id": "0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1", "class": "equities"},
    {"sym": "TSLA",    "id": "0x2a9ac4e2e0ce6c29bce6d27f37c05e94e64c4e45b5f43562e52e3cbdc0e7e8e5", "class": "equities"},
]

HERMES_URL = "https://hermes.pyth.network"
POLL_INTERVAL = 8  # seconds

# ── In-memory state ────────────────────────────────────────────────────────────
prices: dict = {}   # sym -> {price, conf, conf_pct, prev, ts, publish_time}
history: dict = {}  # sym -> list[{price, ts}] (last 60 points)
last_regime: dict = {}

# ── Lifespan ───────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    task = asyncio.create_task(price_loop())
    yield
    task.cancel()

app = FastAPI(title="Macro Oracle API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Pyth Hermes Fetcher ────────────────────────────────────────────────────────
async def fetch_pyth():
    # Hermes expects price feed ids WITHOUT the 0x prefix.
    # Our FEEDS are stored with 0x..., so normalize for requests + mapping.
    def norm(feed_id: str) -> str:
        return feed_id.lower().removeprefix("0x")

    ids_param = "&".join(f"ids[]={norm(f['id'])}" for f in FEEDS)
    url = f"{HERMES_URL}/v2/updates/price/latest?{ids_param}&parsed=true"

    async with aiohttp.ClientSession() as session:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            if resp.status != 200:
                raise Exception(f"Hermes returned {resp.status}")
            data = await resp.json()

    feed_map = {norm(f["id"]): f for f in FEEDS}
    now = time.time()

    for item in data.get("parsed", []):
        feed_id = str(item.get("id", "")).lower()
        feed = feed_map.get(feed_id)
        if not feed:
            continue

        raw = item["price"]
        expo = raw["expo"]
        price = float(raw["price"]) * (10 ** expo)
        conf  = float(raw["conf"])  * (10 ** expo)
        conf_pct = (conf / price * 100) if price else 0
        publish_time = raw.get("publish_time", now)

        sym = feed["sym"]
        prev = prices.get(sym, {}).get("price")

        prices[sym] = {
            "price":        price,
            "conf":         conf,
            "conf_pct":     round(conf_pct, 4),
            "prev":         prev,
            "ts":           now,
            "publish_time": publish_time,
            "class":        feed["class"],
        }

        if sym not in history:
            history[sym] = []
        history[sym].append({"price": price, "ts": now})
        if len(history[sym]) > 60:
            history[sym].pop(0)


async def price_loop():
    while True:
        try:
            await fetch_pyth()
            # Run regime detection after each fetch
            if len(prices) > 5:
                result = detect_regime(prices, history)
                global last_regime
                # Only generate narrative + save if regime changed or no regime yet
                regime_changed = result["regime"] != last_regime.get("regime")
                if regime_changed or not last_regime:
                    narrative = await generate_narrative(result, prices)
                    result["narrative"] = narrative
                    result["ts"] = time.time()
                    last_regime = result
                    save_regime(result)
        except Exception as e:
            print(f"[price_loop] error: {e}")
        await asyncio.sleep(POLL_INTERVAL)


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"name": "Macro Oracle API", "status": "live", "feeds": len(FEEDS)}


@app.get("/feeds")
def get_feeds():
    """List all configured feeds with metadata."""
    return {
        "feeds": FEEDS,
        "count": len(FEEDS),
        "hermes_url": HERMES_URL,
        "poll_interval_seconds": POLL_INTERVAL,
    }


@app.get("/prices/latest")
def get_latest_prices():
    """Latest price + confidence for all feeds."""
    if not prices:
        raise HTTPException(status_code=503, detail="Prices not yet loaded")

    result = {}
    for sym, d in prices.items():
        h = history.get(sym, [])
        # Calculate % changes
        def pct(lookback):
            if len(h) < 2:
                return 0.0
            n = min(lookback, len(h))
            start = h[-n]["price"]
            end   = h[-1]["price"]
            return round(((end - start) / start) * 100, 3) if start else 0.0

        result[sym] = {
            **d,
            "change_1h":  pct(60),   # 60 points * 8s = ~8min, label as live
            "change_live": pct(10),
        }
    return {"prices": result, "ts": time.time()}


@app.get("/prices/history")
def get_price_history(symbol: str, limit: int = 60):
    """Historical price points for a symbol."""
    sym = symbol.upper()
    h = history.get(sym)
    if h is None:
        raise HTTPException(status_code=404, detail=f"Symbol {sym} not found")
    return {
        "symbol": sym,
        "history": h[-limit:],
        "count": len(h),
    }


@app.get("/regime/current")
def get_current_regime():
    """Current detected macro regime."""
    if not last_regime:
        return {"regime": "UNCERTAIN", "confidence": 0, "narrative": "Initializing...", "signals": {}}
    return last_regime


@app.get("/regime/history")
def get_regime_history_endpoint(limit: int = 50):
    """History of detected regime changes."""
    return {"history": get_regime_history(limit)}


@app.post("/publish")
async def publish_narrative(approved: bool = True):
    """
    Generate and optionally publish a narrative to X/Twitter.
    approved=false returns the text for human review only.
    """
    if not last_regime:
        raise HTTPException(status_code=503, detail="No regime data yet")

    result = detect_regime(prices, history)
    narrative = await generate_narrative(result, prices)

    tweet_text = build_tweet(narrative, result["regime"])

    if approved:
        # Try to post if Twitter creds are configured
        tweet_id = await try_post_tweet(tweet_text)
        return {
            "status": "posted" if tweet_id else "skipped_no_creds",
            "tweet_id": tweet_id,
            "text": tweet_text,
        }
    else:
        return {"status": "preview", "text": tweet_text}


def build_tweet(narrative: str, regime: str) -> str:
    tags = {
        "RISK_OFF":   "#Macro #RiskOff #Gold",
        "RISK_ON":    "#Macro #RiskOn #Crypto",
        "DXY_SURGE":  "#DXY #Dollar #Forex",
        "CRYPTO_DEC": "#Bitcoin #Crypto",
        "COMM_CYCLE": "#Commodities #Gold",
        "UNCERTAIN":  "#Macro",
    }
    base_tags = tags.get(regime, "#Macro")
    return f"{narrative}\n\n{base_tags} #PythNetwork\n\n[Live: Pyth Oracle · hermes.pyth.network]"


async def try_post_tweet(text: str) -> Optional[str]:
    import os
    keys = ["TWITTER_API_KEY", "TWITTER_API_SECRET", "TWITTER_ACCESS_TOKEN", "TWITTER_ACCESS_SECRET"]
    if not all(os.environ.get(k) for k in keys):
        return None
    try:
        import tweepy
        client = tweepy.Client(
            consumer_key=os.environ["TWITTER_API_KEY"],
            consumer_secret=os.environ["TWITTER_API_SECRET"],
            access_token=os.environ["TWITTER_ACCESS_TOKEN"],
            access_token_secret=os.environ["TWITTER_ACCESS_SECRET"],
        )
        resp = client.create_tweet(text=text[:280])
        return str(resp.data["id"])
    except Exception as e:
        print(f"[twitter] {e}")
        return None
