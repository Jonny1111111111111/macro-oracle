"""
Regime Detection Engine
Deterministic rules-based classifier with confidence scoring.
Uses Pyth confidence intervals to weight signal quality.
"""

import math
from typing import Any


def pct_change(sym: str, history: dict, lookback: int = 20) -> float:
    """Return % change over last N data points."""
    h = history.get(sym, [])
    if len(h) < 2:
        return 0.0
    n = min(lookback, len(h))
    start = h[-n]["price"]
    end   = h[-1]["price"]
    return ((end - start) / start) * 100 if start else 0.0


def confidence_weight(sym: str, prices: dict) -> float:
    """
    Pyth Pro feature: weight signal by data quality.
    Narrow confidence interval = high quality = weight 1.0
    Wide confidence interval = low quality = weight down to 0.3
    """
    d = prices.get(sym, {})
    conf_pct = d.get("conf_pct", 0.1)
    # conf_pct of 0.01% = excellent, 0.5%+ = noisy
    weight = max(0.3, 1.0 - (conf_pct / 0.5) * 0.7)
    return round(min(1.0, weight), 3)


def detect_regime(prices: dict, history: dict) -> dict:
    # ── Raw % changes ──────────────────────────────────────────────────────
    btc   = pct_change("BTC",     history)
    eth   = pct_change("ETH",     history)
    sol   = pct_change("SOL",     history)
    avax  = pct_change("AVAX",    history)
    gold  = pct_change("XAU",     history)
    silver= pct_change("XAG",     history)
    wti   = pct_change("WTI",     history)
    ngas  = pct_change("NGAS",    history)
    eur   = pct_change("EUR/USD", history)
    gbp   = pct_change("GBP/USD", history)
    jpy   = pct_change("USD/JPY", history)  # positive = dollar strong
    spy   = pct_change("SPY",     history)
    qqq   = pct_change("QQQ",     history)
    nvda  = pct_change("NVDA",    history)

    # ── Confidence weights (Pyth Pro) ──────────────────────────────────────
    w_btc  = confidence_weight("BTC",     prices)
    w_gold = confidence_weight("XAU",     prices)
    w_spy  = confidence_weight("SPY",     prices)
    w_eur  = confidence_weight("EUR/USD", prices)

    # ── Composite signals ─────────────────────────────────────────────────
    crypto_avg  = (btc * w_btc + eth + sol + avax) / (1 + w_btc + 1 + 1) * 4
    equity_avg  = (spy * w_spy + qqq + nvda) / (w_spy + 2) * 3
    metal_avg   = (gold * w_gold + silver) / (w_gold + 1) * 2
    comm_avg    = (wti + ngas + silver) / 3
    dollar_str  = (jpy + (-eur * w_eur) + (-gbp)) / (1 + w_eur + 1) * 3

    # ── Regime scoring ────────────────────────────────────────────────────
    scores: dict[str, float] = {
        "RISK_OFF":   0.0,
        "RISK_ON":    0.0,
        "DXY_SURGE":  0.0,
        "CRYPTO_DEC": 0.0,
        "COMM_CYCLE": 0.0,
        "UNCERTAIN":  0.0,
    }

    # RISK-OFF: gold up, crypto + equities down
    if gold > 0.5 and crypto_avg < -0.8 and equity_avg < -0.5:
        scores["RISK_OFF"] += 5.0
    elif gold > 0.2 and crypto_avg < -0.3:
        scores["RISK_OFF"] += 2.5
    elif gold > 0.1 and equity_avg < 0:
        scores["RISK_OFF"] += 1.0

    # RISK-ON: equities + crypto both positive
    if equity_avg > 0.5 and crypto_avg > 0.8:
        scores["RISK_ON"] += 5.0
    elif equity_avg > 0.2 and crypto_avg > 0.3:
        scores["RISK_ON"] += 2.5
    elif equity_avg > 0.1 and btc > 0:
        scores["RISK_ON"] += 1.0

    # DXY SURGE: dollar strengthening, risk assets under pressure
    if dollar_str > 0.5 and equity_avg < -0.2:
        scores["DXY_SURGE"] += 4.0
    elif dollar_str > 0.3:
        scores["DXY_SURGE"] += 2.0
    elif dollar_str > 0.1:
        scores["DXY_SURGE"] += 0.8

    # CRYPTO DECOUPLING: crypto diverges from equities
    divergence = abs(crypto_avg - equity_avg)
    if divergence > 2.0:
        scores["CRYPTO_DEC"] += 4.0
    elif divergence > 1.0:
        scores["CRYPTO_DEC"] += 2.0
    if crypto_avg > 1.0 and equity_avg < 0.1:
        scores["CRYPTO_DEC"] += 2.0
    elif crypto_avg < -1.0 and equity_avg > 0.1:
        scores["CRYPTO_DEC"] += 1.5

    # COMMODITY CYCLE: metals + energy all bid together
    if metal_avg > 0.5 and wti > 0.5:
        scores["COMM_CYCLE"] += 4.0
    elif metal_avg > 0.3 and comm_avg > 0.2:
        scores["COMM_CYCLE"] += 2.0
    elif gold > 0.3 and wti > 0.2:
        scores["COMM_CYCLE"] += 1.0

    # UNCERTAIN: no signal dominates
    max_score = max(scores.values())
    if max_score < 1.5:
        scores["UNCERTAIN"] += 3.0

    # ── Winner + confidence ────────────────────────────────────────────────
    winner = max(scores, key=lambda k: scores[k])
    total  = sum(scores.values()) or 1.0
    confidence = round((scores[winner] / total) * 100)

    return {
        "regime":     winner,
        "confidence": confidence,
        "scores":     {k: round(v, 2) for k, v in scores.items()},
        "signals": {
            "crypto_avg":  round(crypto_avg,  3),
            "equity_avg":  round(equity_avg,  3),
            "metal_avg":   round(metal_avg,   3),
            "dollar_str":  round(dollar_str,  3),
            "comm_avg":    round(comm_avg,    3),
            "divergence":  round(divergence,  3),
        },
        "raw_changes": {
            "BTC":     round(btc,  3),
            "ETH":     round(eth,  3),
            "SOL":     round(sol,  3),
            "XAU":     round(gold, 3),
            "XAG":     round(silver, 3),
            "WTI":     round(wti,  3),
            "EUR/USD": round(eur,  3),
            "USD/JPY": round(jpy,  3),
            "SPY":     round(spy,  3),
            "QQQ":     round(qqq,  3),
            "NVDA":    round(nvda, 3),
        },
        "confidence_weights": {
            "BTC":     w_btc,
            "XAU":     w_gold,
            "SPY":     w_spy,
            "EUR/USD": w_eur,
        }
    }
