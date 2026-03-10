"""
AI Narrative Generator
Uses Claude (or falls back to deterministic templates) to produce
human-readable macro analysis from regime detection results.
"""

import os
from typing import Optional


REGIME_CONTEXT = {
    "RISK_OFF":   "risk-off environment — capital fleeing to safe havens",
    "RISK_ON":    "risk-on environment — broad appetite for risk assets",
    "DXY_SURGE":  "dollar surge — DXY strengthening weighing on global assets",
    "CRYPTO_DEC": "crypto decoupling — digital assets diverging from TradFi",
    "COMM_CYCLE": "commodity supercycle — real assets in demand",
    "UNCERTAIN":  "uncertain macro environment — mixed signals across classes",
}


def build_prompt(result: dict, prices: dict) -> str:
    raw = result.get("raw_changes", {})
    sigs = result.get("signals", {})
    regime = result.get("regime", "UNCERTAIN")
    confidence = result.get("confidence", 0)

    lines = [
        f"You are a macro analyst. Live Pyth Network oracle data (real-time, institutional-grade):",
        f"",
        f"CRYPTO:   BTC {raw.get('BTC',0):+.2f}%  ETH {raw.get('ETH',0):+.2f}%  SOL {raw.get('SOL',0):+.2f}%",
        f"METALS:   Gold {raw.get('XAU',0):+.2f}%  Silver {raw.get('XAG',0):+.2f}%  Oil {raw.get('WTI',0):+.2f}%",
        f"FOREX:    EUR/USD {raw.get('EUR/USD',0):+.2f}%  USD/JPY {raw.get('USD/JPY',0):+.2f}%",
        f"EQUITIES: SPY {raw.get('SPY',0):+.2f}%  QQQ {raw.get('QQQ',0):+.2f}%  NVDA {raw.get('NVDA',0):+.2f}%",
        f"",
        f"Detected regime: {regime} ({REGIME_CONTEXT[regime]}) — {confidence}% confidence",
        f"Cross-asset signals: crypto_avg={sigs.get('crypto_avg',0):+.2f}%  equity_avg={sigs.get('equity_avg',0):+.2f}%  metal_avg={sigs.get('metal_avg',0):+.2f}%  dollar={sigs.get('dollar_str',0):+.2f}%",
        f"",
        f"Write a 2-3 sentence institutional macro brief for this exact moment.",
        f"Rules: be specific with numbers, explain the cross-asset relationship, no fluff.",
        f"Max 220 characters. Output ONLY the brief text, nothing else.",
    ]
    return "\n".join(lines)


def deterministic_narrative(result: dict, prices: dict) -> str:
    """Fallback narrative when no LLM is configured."""
    raw = result.get("raw_changes", {})
    regime = result.get("regime", "UNCERTAIN")
    conf = result.get("confidence", 0)

    btc = raw.get("BTC", 0)
    gold = raw.get("XAU", 0)
    spy = raw.get("SPY", 0)
    eur = raw.get("EUR/USD", 0)
    jpy = raw.get("USD/JPY", 0)
    wti = raw.get("WTI", 0)

    templates = {
        "RISK_OFF": (
            f"Gold {gold:+.2f}% as safe-haven bid accelerates. "
            f"BTC {btc:+.2f}% and SPY {spy:+.2f}% confirm risk-off rotation. "
            f"Smart money fleeing to hard assets. Watch support levels closely."
        ),
        "RISK_ON": (
            f"BTC {btc:+.2f}% and SPY {spy:+.2f}% moving in lockstep — "
            f"classic risk-on environment. Broad appetite for risk assets across crypto and equities. "
            f"Liquidity conditions appear supportive."
        ),
        "DXY_SURGE": (
            f"Dollar strengthening: USD/JPY {jpy:+.2f}%, EUR/USD {eur:+.2f}%. "
            f"DXY pressure weighing on commodities and risk assets. "
            f"Watch for Fed rate repricing in the rates market."
        ),
        "CRYPTO_DEC": (
            f"Crypto decoupling detected — BTC {btc:+.2f}% while equities SPY {spy:+.2f}%. "
            f"Onchain narrative diverging from traditional finance. "
            f"Structural shift or short-term dislocation? Monitor correlation breakdown."
        ),
        "COMM_CYCLE": (
            f"Commodity supercycle signals — Gold {gold:+.2f}%, Oil {wti:+.2f}%. "
            f"Real asset inflation bid accelerating across metals and energy. "
            f"Watch USD response and EM currency stress."
        ),
        "UNCERTAIN": (
            f"Mixed signals across asset classes — BTC {btc:+.2f}%, Gold {gold:+.2f}%, SPY {spy:+.2f}%. "
            f"No dominant macro theme. Markets in transition. "
            f"Monitor cross-asset correlation for directional clues."
        ),
    }
    return templates.get(regime, templates["UNCERTAIN"])


async def generate_narrative(result: dict, prices: dict) -> str:
    """Generate AI narrative, falling back to deterministic if no API key."""
    api_key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("OPENAI_API_KEY")

    if not api_key:
        return deterministic_narrative(result, prices)

    prompt = build_prompt(result, prices)

    # Try Anthropic first
    if os.environ.get("ANTHROPIC_API_KEY"):
        try:
            import anthropic
            client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
            msg = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=150,
                messages=[{"role": "user", "content": prompt}]
            )
            return msg.content[0].text.strip()
        except Exception as e:
            print(f"[narrator] Anthropic error: {e}")

    # Fallback: OpenAI
    if os.environ.get("OPENAI_API_KEY"):
        try:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
            resp = await client.chat.completions.create(
                model="gpt-4o-mini",
                max_tokens=150,
                messages=[{"role": "user", "content": prompt}]
            )
            return resp.choices[0].message.content.strip()
        except Exception as e:
            print(f"[narrator] OpenAI error: {e}")

    return deterministic_narrative(result, prices)
