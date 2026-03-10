import { useState, useEffect, useCallback, useRef } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────
type RegimeKey = 'RISK_OFF' | 'RISK_ON' | 'DXY_SURGE' | 'CRYPTO_DEC' | 'COMM_CYCLE' | 'UNCERTAIN'
type AssetClass = 'crypto' | 'metals' | 'forex' | 'equities'

interface PriceData {
  price: number
  conf: number
  conf_pct: number
  prev: number | null
  change_1h: number
  change_live: number
  class: AssetClass
  ts: number
}

interface RegimeResult {
  regime: RegimeKey
  confidence: number
  narrative: string
  signals: Record<string, number>
  raw_changes: Record<string, number>
  confidence_weights: Record<string, number>
  ts: number
}

interface HistoryPoint { price: number; ts: number }
interface RegimeEvent  { ts: number; regime: RegimeKey; confidence: number; narrative: string }

// ── Feed config ───────────────────────────────────────────────────────────────
const FEEDS = [
  { sym: 'BTC',     name: 'Bitcoin',   class: 'crypto'   as AssetClass, fmt: '$',  dec: 0, color: '#f7931a' },
  { sym: 'ETH',     name: 'Ethereum',  class: 'crypto'   as AssetClass, fmt: '$',  dec: 0, color: '#627eea' },
  { sym: 'SOL',     name: 'Solana',    class: 'crypto'   as AssetClass, fmt: '$',  dec: 2, color: '#9945ff' },
  { sym: 'AVAX',    name: 'Avalanche', class: 'crypto'   as AssetClass, fmt: '$',  dec: 2, color: '#e84142' },
  { sym: 'PYTH',    name: 'Pyth',      class: 'crypto'   as AssetClass, fmt: '$',  dec: 4, color: '#e6dafe' },
  { sym: 'XAU',     name: 'Gold',      class: 'metals'   as AssetClass, fmt: '$',  dec: 0, color: '#ffd700' },
  { sym: 'XAG',     name: 'Silver',    class: 'metals'   as AssetClass, fmt: '$',  dec: 2, color: '#c0c0c0' },
  { sym: 'WTI',     name: 'Oil',       class: 'metals'   as AssetClass, fmt: '$',  dec: 2, color: '#ff6d00' },
  { sym: 'NGAS',    name: 'Nat Gas',   class: 'metals'   as AssetClass, fmt: '$',  dec: 3, color: '#4fc3f7' },
  { sym: 'EUR/USD', name: 'Euro',      class: 'forex'    as AssetClass, fmt: '',   dec: 4, color: '#5c85d6' },
  { sym: 'GBP/USD', name: 'Pound',     class: 'forex'    as AssetClass, fmt: '',   dec: 4, color: '#cf142b' },
  { sym: 'USD/JPY', name: 'Yen',       class: 'forex'    as AssetClass, fmt: '',   dec: 2, color: '#bc002d' },
  { sym: 'USD/CNH', name: 'Yuan',      class: 'forex'    as AssetClass, fmt: '',   dec: 4, color: '#de2910' },
  { sym: 'SPY',     name: 'S&P 500',   class: 'equities' as AssetClass, fmt: '$',  dec: 0, color: '#26a69a' },
  { sym: 'QQQ',     name: 'NASDAQ',    class: 'equities' as AssetClass, fmt: '$',  dec: 0, color: '#42a5f5' },
  { sym: 'NVDA',    name: 'Nvidia',    class: 'equities' as AssetClass, fmt: '$',  dec: 0, color: '#76b900' },
  { sym: 'TSLA',    name: 'Tesla',     class: 'equities' as AssetClass, fmt: '$',  dec: 0, color: '#cc0000' },
]

const REGIMES: Record<RegimeKey, { label: string; color: string; bg: string; icon: string }> = {
  RISK_OFF:   { label: 'Risk-Off',          color: '#ff4444', bg: 'rgba(255,68,68,0.1)',    icon: '🔴' },
  RISK_ON:    { label: 'Risk-On',           color: '#00e676', bg: 'rgba(0,230,118,0.1)',    icon: '🟢' },
  DXY_SURGE:  { label: 'Dollar Surge',      color: '#ffb300', bg: 'rgba(255,179,0,0.1)',    icon: '🟡' },
  CRYPTO_DEC: { label: 'Crypto Decoupling', color: '#00b0ff', bg: 'rgba(0,176,255,0.1)',    icon: '🔵' },
  COMM_CYCLE: { label: 'Commodity Cycle',   color: '#ff6d00', bg: 'rgba(255,109,0,0.1)',    icon: '🟠' },
  UNCERTAIN:  { label: 'Uncertain',         color: '#78909c', bg: 'rgba(120,144,156,0.1)',  icon: '⚪' },
}

const CLASS_META: Record<AssetClass, { label: string; color: string }> = {
  crypto:   { label: 'Crypto',    color: '#9945ff' },
  metals:   { label: 'Metals & Energy', color: '#ffd700' },
  forex:    { label: 'Forex',     color: '#5c85d6' },
  equities: { label: 'Equities',  color: '#26a69a' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const API = import.meta.env.VITE_API_URL || '/api'

function fmtPrice(feed: typeof FEEDS[0], price: number | null | undefined): string {
  if (!price) return '—'
  if (price > 10000)  return feed.fmt + price.toLocaleString('en', { maximumFractionDigits: 0 })
  if (price > 100)    return feed.fmt + price.toFixed(2)
  if (price > 1)      return feed.fmt + price.toFixed(feed.dec)
  return feed.fmt + price.toFixed(5)
}

function buildSparkPath(pts: HistoryPoint[], w = 100, h = 32): string {
  if (pts.length < 2) return ''
  const prices = pts.map(p => p.price)
  const min = Math.min(...prices), max = Math.max(...prices)
  const range = max - min || 1
  const mapped = pts.map((p, i) => {
    const x = (i / (pts.length - 1)) * w
    const y = h - ((p.price - min) / range) * (h - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return 'M' + mapped.join('L')
}

function timeAgo(ts: number): string {
  const s = Math.floor(Date.now() / 1000 - ts)
  if (s < 60)  return `${s}s ago`
  if (s < 3600) return `${Math.floor(s/60)}m ago`
  return `${Math.floor(s/3600)}h ago`
}

// ── Demo data seed (when API is unreachable) ──────────────────────────────────
function seedDemoData(): Record<string, PriceData> {
  const bases: Record<string, number> = {
    BTC: 82450, ETH: 2180, SOL: 134, AVAX: 22.4, PYTH: 0.048,
    XAU: 2940, XAG: 33.5, WTI: 68.2, NGAS: 3.82,
    'EUR/USD': 1.0834, 'GBP/USD': 1.2945, 'USD/JPY': 148.2, 'USD/CNH': 7.245,
    SPY: 562, QQQ: 475, NVDA: 875, TSLA: 248,
  }
  const result: Record<string, PriceData> = {}
  for (const [sym, base] of Object.entries(bases)) {
    const noise = 1 + (Math.random() - 0.5) * 0.005
    const price = base * noise
    const chg = (Math.random() - 0.5) * 3
    result[sym] = {
      price, conf: price * 0.0002, conf_pct: 0.02,
      prev: price * (1 - chg / 100),
      change_1h: chg, change_live: chg * 0.3,
      class: FEEDS.find(f => f.sym === sym)?.class || 'crypto',
      ts: Date.now() / 1000,
    }
  }
  return result
}

function seedDemoRegime(): RegimeResult {
  return {
    regime: 'RISK_OFF',
    confidence: 72,
    narrative: 'Gold +1.1% as safe-haven bid intensifies. BTC -1.2% and SPY -0.6% confirm risk-off rotation across all major asset classes.',
    signals: { crypto_avg: -1.1, equity_avg: -0.7, metal_avg: 0.9, dollar_str: 0.3 },
    raw_changes: { BTC: -1.2, ETH: -0.8, SOL: 0.4, XAU: 1.1, XAG: 0.8, WTI: -0.5, 'EUR/USD': -0.15, 'USD/JPY': 0.3, SPY: -0.6, QQQ: -0.9, NVDA: -1.8 },
    confidence_weights: { BTC: 0.98, XAU: 0.97, SPY: 0.95, 'EUR/USD': 0.96 },
    ts: Date.now() / 1000,
  }
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [prices, setPrices]           = useState<Record<string, PriceData>>({})
  const [regime, setRegime]           = useState<RegimeResult | null>(null)
  const [history, setHistory]         = useState<Record<string, HistoryPoint[]>>({})
  const [regimeHistory, setRegimeHistory] = useState<RegimeEvent[]>([])
  const [activeClass, setActiveClass] = useState<AssetClass | 'all'>('all')
  const [apiStatus, setApiStatus]     = useState<'connecting' | 'live' | 'demo'>('connecting')
  const [clock, setClock]             = useState('')
  const [publishStatus, setPublishStatus] = useState<'idle' | 'loading' | 'done'>('idle')
  const [publishText, setPublishText] = useState('')
  const prevPrices = useRef<Record<string, number>>({})

  // Clock
  useEffect(() => {
    const tick = () => setClock(new Date().toUTCString().split(' ')[4] + ' UTC')
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  // Fetch prices
  const fetchPrices = useCallback(async () => {
    try {
      const res = await fetch(`${API}/prices/latest`)

      // Backend reachable but still warming up (prices not loaded yet)
      if (res.status === 503) {
        setApiStatus('connecting')
        return
      }

      if (!res.ok) throw new Error()

      const data = await res.json()
      setPrices(data.prices)
      setApiStatus('live')

      // Build history from sparkline
      setHistory(prev => {
        const next = { ...prev }
        for (const [sym, d] of Object.entries(data.prices as Record<string, PriceData>)) {
          if (!next[sym]) next[sym] = []
          next[sym] = [...next[sym], { price: d.price, ts: d.ts }].slice(-60)
        }
        return next
      })
    } catch {
      // Only fall back to demo if the API is actually unreachable
      if (apiStatus === 'connecting') {
        setPrices(seedDemoData())
        setApiStatus('demo')
      }
    }
  }, [apiStatus])

  // Fetch regime
  const fetchRegime = useCallback(async () => {
    try {
      const res = await fetch(`${API}/regime/current`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setRegime(data)
    } catch {
      if (!regime) setRegime(seedDemoRegime())
    }
  }, [regime])

  // Fetch regime history
  const fetchRegimeHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API}/regime/history?limit=20`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setRegimeHistory(data.history)
    } catch {}
  }, [])

  useEffect(() => {
    fetchPrices()
    fetchRegime()
    fetchRegimeHistory()
    const t1 = setInterval(fetchPrices,  8000)
    const t2 = setInterval(fetchRegime,  10000)
    const t3 = setInterval(fetchRegimeHistory, 30000)
    return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3) }
  }, [])

  // Track price flashes
  useEffect(() => {
    const next: Record<string, number> = {}
    for (const [sym, d] of Object.entries(prices)) next[sym] = d.price
    prevPrices.current = next
  }, [prices])

  const handlePublish = async (approved: boolean) => {
    setPublishStatus('loading')
    try {
      const res = await fetch(`${API}/publish?approved=${approved}`, { method: 'POST' })
      const data = await res.json()
      setPublishText(data.text)
      setPublishStatus('done')
    } catch {
      setPublishText(regime?.narrative || '')
      setPublishStatus('done')
    }
  }

  const filteredFeeds = FEEDS.filter(f => activeClass === 'all' || f.class === activeClass)
  const r = regime ? REGIMES[regime.regime] : REGIMES.UNCERTAIN

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app" style={{ background: '#040810', minHeight: '100vh', color: '#d0e8ff', fontFamily: "'IBM Plex Mono', 'Courier New', monospace", fontSize: 13 }}>

      {/* TOPBAR */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', height: 52,
        background: '#060d18',
        borderBottom: '1px solid #0e2540',
        boxShadow: '0 1px 20px rgba(0,180,255,0.07)',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span className="brand-name" style={{ fontFamily: "'Bebas Neue','Impact',sans-serif", fontSize: 24, letterSpacing: '0.1em', color: '#00d4ff', textShadow: '0 0 20px rgba(0,212,255,0.4)' }}>
            MACRO ORACLE
          </span>
          <span style={{ fontSize: 9, color: '#3d6080', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
            Cross-Asset Intelligence
          </span>
          <span style={{ fontSize: 9, color: '#ffb300', border: '1px solid rgba(255,179,0,0.3)', padding: '2px 7px', borderRadius: 2, letterSpacing: '0.12em', background: 'rgba(255,179,0,0.05)' }}>
            ⬡ PYTH NETWORK
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: apiStatus === 'live' ? '#00e676' : '#ffb300', border: `1px solid ${apiStatus === 'live' ? 'rgba(0,230,118,0.3)' : 'rgba(255,179,0,0.3)'}`, padding: '3px 10px', borderRadius: 2, letterSpacing: '0.15em' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: apiStatus === 'live' ? '#00e676' : '#ffb300', boxShadow: `0 0 6px ${apiStatus === 'live' ? '#00e676' : '#ffb300'}`, animation: 'pulse 1.2s ease-in-out infinite' }} />
            {apiStatus === 'live' ? 'LIVE · PYTH HERMES' : apiStatus === 'demo' ? 'DEMO MODE' : 'CONNECTING...'}
          </div>
          <span style={{ fontSize: 11, color: '#3d6080', letterSpacing: '0.05em' }}>{clock}</span>
        </div>
      </header>

      {/* REGIME BANNER */}
      {regime && (
        <div className="regimeBanner regime-grid" style={{
          display: 'grid', gridTemplateColumns: (typeof window !== 'undefined' && window.innerWidth < 768) ? '1fr' : '320px 1fr 260px',
          borderBottom: '1px solid #0e2540',
          background: '#060d18',
          position: 'relative', overflow: 'hidden',
        }}>
          {/* Glow */}
          <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse 50% 100% at 15% 50%, ${r.bg} 0%, transparent 70%)`, pointerEvents: 'none' }} />

          {/* Regime name */}
          <div style={{ padding: '20px 28px', borderRight: '1px solid #0e2540', position: 'relative' }}>
            <div style={{ fontSize: 9, color: '#3d6080', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 8 }}>
              Current Macro Regime
            </div>
            <div style={{ fontFamily: "'Bebas Neue','Impact',sans-serif", fontSize: 32, letterSpacing: '0.06em', color: r.color, lineHeight: 1, marginBottom: 10 }}>
              {r.icon} {r.label.toUpperCase()}
            </div>
            {/* Confidence bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, height: 3, background: '#0e2540', borderRadius: 2 }}>
                <div style={{ width: `${regime.confidence}%`, height: '100%', background: r.color, borderRadius: 2, transition: 'width 0.8s ease' }} />
              </div>
              <span style={{ fontSize: 11, color: '#3d6080' }}>{regime.confidence}%</span>
            </div>
            {/* Key drivers */}
            <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Object.entries(regime.raw_changes || {}).slice(0, 4).map(([sym, chg]) => (
                <span key={sym} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 2, background: (chg as number) >= 0 ? 'rgba(0,230,118,0.1)' : 'rgba(255,68,68,0.1)', color: (chg as number) >= 0 ? '#00e676' : '#ff4444', border: `1px solid ${(chg as number) >= 0 ? 'rgba(0,230,118,0.2)' : 'rgba(255,68,68,0.2)'}` }}>
                  {sym} {(chg as number) >= 0 ? '+' : ''}{(chg as number).toFixed(2)}%
                </span>
              ))}
            </div>
          </div>

          {/* Narrative */}
          <div style={{ padding: '20px 28px', position: 'relative' }}>
            <div style={{ fontSize: 9, color: '#3d6080', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 10 }}>
              Live AI Macro Brief · Powered by Pyth Oracle Data
            </div>
            <p style={{ fontFamily: "'Rajdhani', 'Arial', sans-serif", fontSize: 16, lineHeight: 1.65, color: '#d0e8ff', fontWeight: 400, maxWidth: 640 }}>
              {regime.narrative || 'Analyzing cross-asset flows...'}
            </p>
            <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
              {publishStatus === 'idle' && (
                <>
                  <button onClick={() => handlePublish(false)} style={{ fontSize: 10, padding: '5px 12px', background: 'transparent', border: '1px solid #0e2540', color: '#3d6080', cursor: 'pointer', borderRadius: 2, letterSpacing: '0.08em', fontFamily: 'inherit' }}>
                    Preview Tweet
                  </button>
                  <button onClick={() => handlePublish(true)} style={{ fontSize: 10, padding: '5px 12px', background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.3)', color: '#00d4ff', cursor: 'pointer', borderRadius: 2, letterSpacing: '0.08em', fontFamily: 'inherit' }}>
                    Publish to X →
                  </button>
                </>
              )}
              {publishStatus === 'loading' && <span style={{ fontSize: 10, color: '#3d6080' }}>Generating...</span>}
              {publishStatus === 'done' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
                  <div style={{ fontSize: 10, padding: 10, background: '#0a1520', border: '1px solid #0e2540', borderRadius: 3, color: '#a0c8e0', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {publishText}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { navigator.clipboard.writeText(publishText) }} style={{ fontSize: 10, padding: '4px 10px', background: 'transparent', border: '1px solid #0e2540', color: '#3d6080', cursor: 'pointer', borderRadius: 2, fontFamily: 'inherit' }}>Copy</button>
                    <button onClick={() => setPublishStatus('idle')} style={{ fontSize: 10, padding: '4px 10px', background: 'transparent', border: '1px solid #0e2540', color: '#3d6080', cursor: 'pointer', borderRadius: 2, fontFamily: 'inherit' }}>Reset</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Signals */}
          <div style={{ padding: '20px 24px', borderLeft: '1px solid #0e2540', position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10 }}>
            {[
              { label: 'Crypto Avg',   val: regime.signals?.crypto_avg,  fmt: (v: number) => `${v >= 0 ? '+' : ''}${v?.toFixed(2)}%` },
              { label: 'Equity Avg',   val: regime.signals?.equity_avg,  fmt: (v: number) => `${v >= 0 ? '+' : ''}${v?.toFixed(2)}%` },
              { label: 'Metal Avg',    val: regime.signals?.metal_avg,   fmt: (v: number) => `${v >= 0 ? '+' : ''}${v?.toFixed(2)}%` },
              { label: 'Dollar Str',   val: regime.signals?.dollar_str,  fmt: (v: number) => `${v >= 0 ? '+' : ''}${v?.toFixed(2)}%` },
              { label: 'Divergence',   val: regime.signals?.divergence,  fmt: (v: number) => `${v?.toFixed(2)}` },
            ].map(({ label, val, fmt }) => {
              const v = val ?? 0
              const pos = v >= 0
              const cls = label === 'Divergence' ? '#00d4ff' : pos ? '#00e676' : '#ff4444'
              return (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
                  <span style={{ color: '#3d6080' }}>{label}</span>
                  <span style={{ padding: '2px 8px', borderRadius: 2, background: `${cls}18`, color: cls, border: `1px solid ${cls}30`, fontSize: 10, fontWeight: 600 }}>
                    {fmt(v)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ASSET CLASS TABS */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '0 24px', background: '#060d18', borderBottom: '1px solid #0e2540' }}>
        {(['all', 'crypto', 'metals', 'forex', 'equities'] as const).map(cls => (
          <button key={cls} onClick={() => setActiveClass(cls)} style={{
            padding: '12px 20px', fontSize: 10, fontFamily: 'inherit',
            background: activeClass === cls ? '#0a1a2e' : 'transparent',
            border: 'none', borderBottom: `2px solid ${activeClass === cls ? '#00d4ff' : 'transparent'}`,
            color: activeClass === cls ? '#00d4ff' : '#3d6080',
            cursor: 'pointer', letterSpacing: '0.12em', textTransform: 'uppercase', transition: 'all 0.15s',
          }}>
            {cls === 'all' ? 'All Assets' : CLASS_META[cls]?.label || cls}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', fontSize: 10, color: '#3d6080', paddingRight: 8 }}>
          {Object.keys(prices).length} feeds · refreshing every 8s
        </div>
      </div>

      {/* ASSET GRID */}
      <div className="assetGrid" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: 1, background: '#0e2540',
        padding: 0,
      }}>
        {filteredFeeds.map(feed => {
          const d = prices[feed.sym]
          const h = history[feed.sym] || []
          const sparkPath = buildSparkPath(h, 100, 32)
          const chg = d?.change_1h ?? 0
          const up  = chg >= 0
          const isFlashing = d && d.prev && d.price !== d.prev

          return (
            <div key={feed.sym} style={{
              background: '#060d18',
              padding: '14px 16px',
              cursor: 'pointer',
              transition: 'background 0.15s',
              borderBottom: `2px solid ${feed.color}22`,
              position: 'relative', overflow: 'hidden',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#0a1520')}
            onMouseLeave={e => (e.currentTarget.style.background = '#060d18')}
            >
              {/* Left accent */}
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: feed.color, opacity: 0.6 }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: feed.color, letterSpacing: '0.04em' }}>{feed.sym}</div>
                  <div style={{ fontSize: 9, color: '#3d6080', marginTop: 1 }}>{feed.name}</div>
                </div>
                <div style={{
                  fontSize: 9, padding: '2px 6px', borderRadius: 2,
                  background: up ? 'rgba(0,230,118,0.1)' : 'rgba(255,68,68,0.1)',
                  color: up ? '#00e676' : '#ff4444',
                  border: `1px solid ${up ? 'rgba(0,230,118,0.25)' : 'rgba(255,68,68,0.25)'}`,
                  fontWeight: 700,
                }}>
                  {up ? '+' : ''}{chg.toFixed(2)}%
                </div>
              </div>

              <div style={{ fontSize: 20, fontWeight: 500, color: '#d0e8ff', letterSpacing: '0.05em', marginBottom: 6, fontFamily: "'Bebas Neue','Impact',sans-serif" }}>
                {fmtPrice(feed, d?.price)}
              </div>

              {/* Sparkline */}
              <svg width="100%" height="32" viewBox="0 0 100 32" preserveAspectRatio="none" style={{ display: 'block', marginBottom: 4 }}>
                {sparkPath && (
                  <>
                    <defs>
                      <linearGradient id={`g-${feed.sym}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={feed.color} stopOpacity="0.3" />
                        <stop offset="100%" stopColor={feed.color} stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path d={sparkPath + ' L100,32 L0,32 Z'} fill={`url(#g-${feed.sym})`} />
                    <path d={sparkPath} fill="none" stroke={feed.color} strokeWidth="1.2" opacity="0.9" />
                  </>
                )}
              </svg>

              {/* Confidence interval */}
              {d?.conf_pct !== undefined && (
                <div style={{ fontSize: 9, color: '#2a4a64', display: 'flex', justifyContent: 'space-between' }}>
                  <span>±{d.conf_pct.toFixed(3)}% conf</span>
                  <span style={{ color: d.conf_pct < 0.05 ? '#00e676' : d.conf_pct < 0.2 ? '#ffb300' : '#ff4444' }}>
                    {d.conf_pct < 0.05 ? 'HQ' : d.conf_pct < 0.2 ? 'MED' : 'LOW'}
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* REGIME HISTORY TIMELINE */}
      <div style={{ padding: '20px 24px', borderTop: '1px solid #0e2540', background: '#060d18' }}>
        <div style={{ fontSize: 9, color: '#3d6080', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 14 }}>
          Regime History Timeline
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(regimeHistory.length > 0 ? regimeHistory : [
            { ts: Date.now()/1000 - 180, regime: 'RISK_OFF' as RegimeKey,   confidence: 72, narrative: 'Gold +1.1% as safe-haven demand accelerates. BTC and equities both under pressure.' },
            { ts: Date.now()/1000 - 720, regime: 'UNCERTAIN' as RegimeKey,  confidence: 45, narrative: 'Mixed signals. No clear macro theme dominant across asset classes.' },
            { ts: Date.now()/1000 - 1800, regime: 'RISK_ON' as RegimeKey,   confidence: 68, narrative: 'Broad risk appetite. SPY and BTC both bid, gold flat.' },
          ]).slice(0, 8).map((event, i) => {
            const rr = REGIMES[event.regime as RegimeKey] || REGIMES.UNCERTAIN
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '140px 160px 1fr', gap: 12, alignItems: 'center', padding: '10px 14px', background: '#040810', border: '1px solid #0a1826', borderRadius: 3, borderLeft: `3px solid ${rr.color}` }}>
                <div>
                  <div style={{ fontSize: 10, color: '#3d6080' }}>{timeAgo(event.ts)}</div>
                  <div style={{ fontSize: 9, color: '#1e3a52', marginTop: 2 }}>
                    {new Date(event.ts * 1000).toLocaleTimeString()}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: rr.color }}>{rr.icon} {rr.label}</div>
                  <div style={{ fontSize: 9, color: '#3d6080', marginTop: 2 }}>{event.confidence}% confidence</div>
                </div>
                <div style={{ fontSize: 11, color: '#7090a8', lineHeight: 1.4, fontFamily: "'Rajdhani','Arial',sans-serif" }}>
                  {event.narrative}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* FOOTER */}
      <footer style={{
        padding: '12px 24px', borderTop: '1px solid #0a1826',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: '#040810', fontSize: 9, color: '#1e3a52', letterSpacing: '0.1em',
      }}>
        <span>MACRO ORACLE · Built for Pyth Network Hackathon 2026 · Apache 2.0</span>
        <span style={{ color: '#ffb300', opacity: 0.6 }}>⬡ ORACLE DATA: PYTH HERMES · hermes.pyth.network · Feed IDs: {FEEDS.length} active</span>
      </footer>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=Bebas+Neue&family=Rajdhani:wght@400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #040810; overflow-x: hidden; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #040810; }
        ::-webkit-scrollbar-thumb { background: #0e2540; border-radius: 3px; }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.3;transform:scale(0.7)} }

        /* Mobile responsiveness */
        @media (max-width: 768px) {
          .regime-grid { grid-template-columns: 1fr !important; }
          header { padding: 0 12px !important; }
          .brand-name { font-size: 18px !important; }
        }

        @media (max-width: 640px) {
          .regimeBanner { grid-template-columns: 1fr !important; }
          .assetGrid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          .app { font-size: 12px !important; }

          /* Reduce padding in key areas (topbar/banner) */
          header { padding: 0 12px !important; }

          /* Prevent any accidental overflows from wide text */
          .regimeBanner, .assetGrid { max-width: 100vw; }
        }

        @media (max-width: 420px) {
          .assetGrid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  )
}
