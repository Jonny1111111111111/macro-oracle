import { useState, useEffect, useCallback, useRef } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────
type RegimeKey = 'RISK_OFF' | 'RISK_ON' | 'DXY_SURGE' | 'CRYPTO_DEC' | 'COMM_CYCLE' | 'UNCERTAIN'
type AssetClass = 'crypto' | 'metals' | 'forex' | 'equities'

interface PriceData {
  price: number; conf: number; conf_pct: number
  prev: number | null; change_1h: number; change_live: number
  class: AssetClass; ts: number
}
interface RegimeResult {
  regime: RegimeKey; confidence: number; narrative: string
  signals: Record<string, number>; raw_changes: Record<string, number>
  confidence_weights: Record<string, number>; ts: number
}
interface HistoryPoint { price: number; ts: number }
interface RegimeEvent { ts: number; regime: RegimeKey; confidence: number; narrative: string }
interface Toast { id: number; message: string; color: string }

// ── Feed config ───────────────────────────────────────────────────────────────
const FEEDS = [
  { sym:'BTC',     name:'Bitcoin',   class:'crypto'   as AssetClass, fmt:'$', dec:0, color:'#f7931a' },
  { sym:'ETH',     name:'Ethereum',  class:'crypto'   as AssetClass, fmt:'$', dec:0, color:'#627eea' },
  { sym:'SOL',     name:'Solana',    class:'crypto'   as AssetClass, fmt:'$', dec:2, color:'#9945ff' },
  { sym:'AVAX',    name:'Avalanche', class:'crypto'   as AssetClass, fmt:'$', dec:2, color:'#e84142' },
  { sym:'PYTH',    name:'Pyth',      class:'crypto'   as AssetClass, fmt:'$', dec:4, color:'#e6dafe' },
  { sym:'XAU',     name:'Gold',      class:'metals'   as AssetClass, fmt:'$', dec:0, color:'#ffd700' },
  { sym:'XAG',     name:'Silver',    class:'metals'   as AssetClass, fmt:'$', dec:2, color:'#c0c0c0' },
  { sym:'WTI',     name:'Oil',       class:'metals'   as AssetClass, fmt:'$', dec:2, color:'#ff6d00' },
  { sym:'NGAS',    name:'Nat Gas',   class:'metals'   as AssetClass, fmt:'$', dec:3, color:'#4fc3f7' },
  { sym:'EUR/USD', name:'Euro',      class:'forex'    as AssetClass, fmt:'',  dec:4, color:'#5c85d6' },
  { sym:'GBP/USD', name:'Pound',     class:'forex'    as AssetClass, fmt:'',  dec:4, color:'#cf142b' },
  { sym:'USD/JPY', name:'Yen',       class:'forex'    as AssetClass, fmt:'',  dec:2, color:'#bc002d' },
  { sym:'USD/CNH', name:'Yuan',      class:'forex'    as AssetClass, fmt:'',  dec:4, color:'#de2910' },
  { sym:'SPY',     name:'S&P 500',   class:'equities' as AssetClass, fmt:'$', dec:0, color:'#26a69a' },
  { sym:'QQQ',     name:'NASDAQ',    class:'equities' as AssetClass, fmt:'$', dec:0, color:'#42a5f5' },
  { sym:'NVDA',    name:'Nvidia',    class:'equities' as AssetClass, fmt:'$', dec:0, color:'#76b900' },
  { sym:'TSLA',    name:'Tesla',     class:'equities' as AssetClass, fmt:'$', dec:0, color:'#cc0000' },
]

const CLASS_META: Record<AssetClass, { label: string; color: string; icon: string }> = {
  crypto:   { label:'Crypto',         color:'#9945ff', icon:'₿' },
  metals:   { label:'Metals & Energy',color:'#ffd700', icon:'⬡' },
  forex:    { label:'Forex',          color:'#5c85d6', icon:'₤' },
  equities: { label:'Equities',       color:'#26a69a', icon:'📈' },
}

const REGIMES: Record<RegimeKey, { label:string; color:string; bg:string; icon:string }> = {
  RISK_OFF:   { label:'Risk-Off',          color:'#ff4444', bg:'rgba(255,68,68,0.12)',   icon:'🔴' },
  RISK_ON:    { label:'Risk-On',           color:'#00e676', bg:'rgba(0,230,118,0.12)',   icon:'🟢' },
  DXY_SURGE:  { label:'Dollar Surge',      color:'#ffb300', bg:'rgba(255,179,0,0.12)',   icon:'🟡' },
  CRYPTO_DEC: { label:'Crypto Decoupling', color:'#00b0ff', bg:'rgba(0,176,255,0.12)',   icon:'🔵' },
  COMM_CYCLE: { label:'Commodity Cycle',   color:'#ff6d00', bg:'rgba(255,109,0,0.12)',   icon:'🟠' },
  UNCERTAIN:  { label:'Uncertain',         color:'#78909c', bg:'rgba(120,144,156,0.12)', icon:'⚪' },
}

const API = (import.meta as any).env?.VITE_API_URL || '/api'

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtPrice(feed: typeof FEEDS[0], price: number | null | undefined): string {
  if (!price) return '—'
  if (price > 10000) return feed.fmt + price.toLocaleString('en', { maximumFractionDigits: 0 })
  if (price > 100)   return feed.fmt + price.toFixed(2)
  if (price > 1)     return feed.fmt + price.toFixed(feed.dec)
  return feed.fmt + price.toFixed(5)
}

function buildSparkPath(pts: HistoryPoint[], w = 100, h = 36): string {
  if (pts.length < 2) return ''
  const prices = pts.map(p => p.price)
  const min = Math.min(...prices), max = Math.max(...prices)
  const range = max - min || 1
  return 'M' + pts.map((p, i) => {
    const x = (i / (pts.length - 1)) * w
    const y = h - ((p.price - min) / range) * (h - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join('L')
}

function timeAgo(ts: number): string {
  const s = Math.floor(Date.now() / 1000 - ts)
  if (s < 60)   return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

function seedDemoData(): Record<string, PriceData> {
  const bases: Record<string, number> = {
    BTC:82450,ETH:2180,SOL:134,AVAX:22.4,PYTH:0.048,
    XAU:2940,XAG:33.5,WTI:68.2,NGAS:3.82,
    'EUR/USD':1.0834,'GBP/USD':1.2945,'USD/JPY':148.2,'USD/CNH':7.245,
    SPY:562,QQQ:475,NVDA:875,TSLA:248,
  }
  const result: Record<string, PriceData> = {}
  for (const [sym, base] of Object.entries(bases)) {
    const noise = 1 + (Math.random() - 0.5) * 0.005
    const price = base * noise
    const chg = (Math.random() - 0.5) * 3
    result[sym] = { price, conf: price * 0.0002, conf_pct: 0.02, prev: price * (1 - chg / 100), change_1h: chg, change_live: chg * 0.3, class: FEEDS.find(f => f.sym === sym)?.class || 'crypto', ts: Date.now() / 1000 }
  }
  return result
}

// ── Animated Background Canvas ────────────────────────────────────────────────
function BackgroundCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')!
    let animId: number
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const resize = () => {
      canvas.width  = window.innerWidth  * dpr
      canvas.height = window.innerHeight * dpr
      ctx.scale(dpr, dpr)
    }
    resize()
    window.addEventListener('resize', resize)

    const N = 55
    const particles = Array.from({ length: N }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: Math.random() * 2 + 1,
    }))

    let t = 0
    const draw = () => {
      t += 0.004
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)

      // Gradient mesh background
      const grad = ctx.createRadialGradient(
        window.innerWidth * (0.5 + 0.3 * Math.sin(t)),
        window.innerHeight * (0.5 + 0.2 * Math.cos(t * 0.7)),
        0,
        window.innerWidth * 0.5, window.innerHeight * 0.5,
        window.innerWidth * 0.8
      )
      grad.addColorStop(0, 'rgba(0,30,60,0.95)')
      grad.addColorStop(0.5, 'rgba(2,10,25,0.98)')
      grad.addColorStop(1, 'rgba(4,8,16,1)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight)

      // Floating orbs
      const orbs = [
        { x: window.innerWidth * 0.2, y: window.innerHeight * 0.3, r: 200, c: 'rgba(0,150,255,0.04)' },
        { x: window.innerWidth * 0.8, y: window.innerHeight * 0.6, r: 250, c: 'rgba(0,230,118,0.03)' },
        { x: window.innerWidth * 0.5, y: window.innerHeight * 0.8, r: 180, c: 'rgba(153,69,255,0.04)' },
      ]
      orbs.forEach(o => {
        const og = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r)
        og.addColorStop(0, o.c)
        og.addColorStop(1, 'transparent')
        ctx.fillStyle = og
        ctx.beginPath()
        ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2)
        ctx.fill()
      })

      // Move + draw particles
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy
        if (p.x < 0 || p.x > window.innerWidth)  p.vx *= -1
        if (p.y < 0 || p.y > window.innerHeight) p.vy *= -1
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(0,180,255,0.5)'
        ctx.fill()
      })

      // Connection lines
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const dx = particles[i].x - particles[j].x
          const dy = particles[i].y - particles[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 120) {
            ctx.beginPath()
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
            ctx.strokeStyle = `rgba(0,180,255,${0.15 * (1 - dist / 120)})`
            ctx.lineWidth = 0.5
            ctx.stroke()
          }
        }
      }

      animId = requestAnimationFrame(draw)
    }
    draw()
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize) }
  }, [])
  return <canvas ref={canvasRef} style={{ position:'fixed', top:0, left:0, width:'100%', height:'100%', zIndex:0, pointerEvents:'none' }} />
}

// ── Asset Card ────────────────────────────────────────────────────────────────
function AssetCard({ feed, d, h }: { feed: typeof FEEDS[0]; d?: PriceData; h: HistoryPoint[] }) {
  const [flash, setFlash] = useState<'up'|'dn'|null>(null)
  const prevPrice = useRef<number | null>(null)

  useEffect(() => {
    if (!d) return
    if (prevPrice.current !== null && prevPrice.current !== d.price) {
      setFlash(d.price > prevPrice.current ? 'up' : 'dn')
      setTimeout(() => setFlash(null), 600)
    }
    prevPrice.current = d.price
  }, [d?.price])

  const chg = d?.change_1h ?? 0
  const up = chg >= 0
  const sparkPath = buildSparkPath(h, 100, 36)
  const stale = d ? (Date.now() / 1000 - d.ts) > 30 : false
  const confQ = !d ? 'LOW' : d.conf_pct < 0.05 ? 'HQ' : d.conf_pct < 0.2 ? 'MED' : 'LOW'
  const confColor = confQ === 'HQ' ? '#00e676' : confQ === 'MED' ? '#ffb300' : '#ff4444'

  return (
    <div style={{
      background: flash === 'up' ? 'rgba(0,230,118,0.08)' : flash === 'dn' ? 'rgba(255,68,68,0.08)' : 'rgba(6,13,24,0.7)',
      backdropFilter: 'blur(12px)',
      border: `1px solid ${stale ? '#ff444440' : feed.color + '30'}`,
      borderLeft: `3px solid ${feed.color}`,
      borderRadius: 8,
      padding: '12px 14px',
      cursor: 'pointer',
      transition: 'all 0.3s ease',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {stale && <div style={{ position:'absolute', top:4, right:4, fontSize:8, color:'#ff4444', background:'rgba(255,68,68,0.15)', padding:'1px 4px', borderRadius:2 }}>STALE</div>}

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:6 }}>
        <div>
          <div style={{ fontSize:13, fontWeight:700, color:feed.color, letterSpacing:'0.04em' }}>{feed.sym}</div>
          <div style={{ fontSize:9, color:'#3d6080', marginTop:1 }}>{feed.name}</div>
        </div>
        <div style={{ fontSize:9, padding:'2px 6px', borderRadius:3, fontWeight:700, background: up ? 'rgba(0,230,118,0.12)' : 'rgba(255,68,68,0.12)', color: up ? '#00e676' : '#ff4444', border:`1px solid ${up ? 'rgba(0,230,118,0.3)' : 'rgba(255,68,68,0.3)'}` }}>
          {up ? '+' : ''}{chg.toFixed(2)}%
        </div>
      </div>

      <div style={{ fontSize:20, fontWeight:600, color:'#d0e8ff', letterSpacing:'0.02em', marginBottom:6, fontFamily:"'Bebas Neue','Impact',sans-serif" }}>
        {fmtPrice(feed, d?.price)}
      </div>

      {/* Sparkline with gradient fill */}
      <svg width="100%" height="36" viewBox="0 0 100 36" preserveAspectRatio="none" style={{ display:'block', marginBottom:6 }}>
        {sparkPath && <>
          <defs>
            <linearGradient id={`sg-${feed.sym.replace('/','_')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={feed.color} stopOpacity="0.4" />
              <stop offset="100%" stopColor={feed.color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={sparkPath + ' L100,36 L0,36 Z'} fill={`url(#sg-${feed.sym.replace('/','_')})`} />
          <path d={sparkPath} fill="none" stroke={feed.color} strokeWidth="1.5" opacity="0.9" />
        </>}
      </svg>

      {/* Confidence quality bar */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
        <div style={{ flex:1, height:2, background:'#0e2540', borderRadius:1, marginRight:8 }}>
          <div style={{ width: confQ === 'HQ' ? '90%' : confQ === 'MED' ? '55%' : '20%', height:'100%', background:confColor, borderRadius:1, transition:'width 0.5s ease' }} />
        </div>
        <span style={{ fontSize:8, color:confColor, fontWeight:700, letterSpacing:'0.08em' }}>{confQ}</span>
      </div>

      <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:'#2a4a64' }}>
        <span>±{d?.conf_pct?.toFixed(3) ?? '—'}%</span>
        <span>{d ? timeAgo(d.ts) : '—'}</span>
      </div>
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [prices, setPrices]         = useState<Record<string, PriceData>>({})
  const [regime, setRegime]         = useState<RegimeResult | null>(null)
  const [history, setHistory]       = useState<Record<string, HistoryPoint[]>>({})
  const [regimeHistory, setRegimeHistory] = useState<RegimeEvent[]>([])
  const [apiStatus, setApiStatus]   = useState<'connecting'|'live'|'demo'>('connecting')
  const [clock, setClock]           = useState('')
  const [publishStatus, setPublishStatus] = useState<'idle'|'loading'|'done'>('idle')
  const [publishText, setPublishText] = useState('')
  const [toasts, setToasts]         = useState<Toast[]>([])
  const [updateCount, setUpdateCount] = useState(0)
  const [regimeStart, setRegimeStart] = useState<number>(Date.now() / 1000)
  const prevRegime = useRef<RegimeKey | null>(null)
  const toastId = useRef(0)

  const addToast = (message: string, color: string) => {
    const id = toastId.current++
    setToasts(t => [...t, { id, message, color }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }

  useEffect(() => {
    const t = setInterval(() => setClock(new Date().toUTCString().split(' ')[4] + ' UTC'), 1000)
    return () => clearInterval(t)
  }, [])

  const fetchPrices = useCallback(async () => {
    try {
      const res = await fetch(`${API}/prices/latest`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setPrices(data.prices)
      setApiStatus('live')
      setUpdateCount(c => c + 1)
      setHistory(prev => {
        const next = { ...prev }
        for (const [sym, d] of Object.entries(data.prices as Record<string, PriceData>)) {
          if (!next[sym]) next[sym] = []
          next[sym] = [...next[sym], { price: d.price, ts: d.ts }].slice(-60)
        }
        return next
      })
    } catch {
      if (apiStatus === 'connecting') { setPrices(seedDemoData()); setApiStatus('demo') }
    }
  }, [apiStatus])

  const fetchRegime = useCallback(async () => {
    try {
      const res = await fetch(`${API}/regime/current`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      if (prevRegime.current && prevRegime.current !== data.regime) {
        const r = REGIMES[data.regime as RegimeKey]
        addToast(`${r.icon} Regime shift: ${r.label}`, r.color)
        setRegimeStart(Date.now() / 1000)
      }
      prevRegime.current = data.regime
      setRegime(data)
    } catch {
      if (!regime) {
        setRegime({ regime:'RISK_OFF', confidence:72, narrative:'Gold +1.1% as safe-haven demand accelerates. BTC and equities both under pressure confirming risk-off rotation.', signals:{ crypto_avg:-1.1, equity_avg:-0.7, metal_avg:0.9, dollar_str:0.3, divergence:0.4 }, raw_changes:{ BTC:-1.2, ETH:-0.8, SOL:0.4, XAU:1.1, XAG:0.8, WTI:-0.5, 'EUR/USD':-0.15, 'USD/JPY':0.3, SPY:-0.6, QQQ:-0.9, NVDA:-1.8 }, confidence_weights:{ BTC:0.98, XAU:0.97, SPY:0.95, 'EUR/USD':0.96 }, ts: Date.now()/1000 })
      }
    }
  }, [regime])

  const fetchRegimeHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API}/regime/history?limit=20`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setRegimeHistory(data.history)
    } catch {}
  }, [])

  useEffect(() => {
    fetchPrices(); fetchRegime(); fetchRegimeHistory()
    const t1 = setInterval(fetchPrices, 8000)
    const t2 = setInterval(fetchRegime, 10000)
    const t3 = setInterval(fetchRegimeHistory, 30000)
    return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3) }
  }, [])

  const handlePublish = async (approved: boolean) => {
    setPublishStatus('loading')
    try {
      const res = await fetch(`${API}/publish?approved=${approved}`, { method:'POST' })
      const data = await res.json()
      setPublishText(data.text)
    } catch {
      setPublishText(regime?.narrative || '')
    }
    setPublishStatus('done')
  }

  const exportBrief = () => {
    if (!regime) return
    const r = REGIMES[regime.regime]
    const lines = [
      `# Macro Oracle Brief`,
      `**Generated:** ${new Date().toUTCString()}`,
      `**Powered by:** Pyth Network`,
      ``,
      `## Current Regime: ${r.icon} ${r.label}`,
      `**Confidence:** ${regime.confidence}%`,
      ``,
      `## AI Narrative`,
      regime.narrative,
      ``,
      `## Key Signals`,
      ...Object.entries(regime.signals).map(([k, v]) => `- **${k}:** ${(v as number) >= 0 ? '+' : ''}${(v as number).toFixed(3)}`),
      ``,
      `## Price Changes`,
      ...Object.entries(regime.raw_changes).map(([k, v]) => `- **${k}:** ${(v as number) >= 0 ? '+' : ''}${(v as number).toFixed(2)}%`),
      ``,
      `## Live Prices`,
      ...FEEDS.map(f => { const d = prices[f.sym]; return d ? `- **${f.sym}:** ${fmtPrice(f, d.price)} (${d.change_1h >= 0 ? '+' : ''}${d.change_1h.toFixed(2)}%)` : '' }).filter(Boolean),
    ]
    const blob = new Blob([lines.join('\n')], { type:'text/markdown' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `macro-brief-${Date.now()}.md`; a.click()
  }

  // Fear & Greed Index
  const fearGreed = (() => {
    if (!regime) return { score: 50, label: 'Neutral', color: '#ffb300' }
    const s = regime.signals
    const raw = ((s.crypto_avg || 0) + (s.equity_avg || 0) - (s.metal_avg || 0) * 0.5 - (s.dollar_str || 0) * 0.3)
    const score = Math.round(Math.min(100, Math.max(0, 50 + raw * 8)))
    const label = score >= 75 ? 'Extreme Greed' : score >= 55 ? 'Greed' : score >= 45 ? 'Neutral' : score >= 25 ? 'Fear' : 'Extreme Fear'
    const color = score >= 75 ? '#00e676' : score >= 55 ? '#69f0ae' : score >= 45 ? '#ffb300' : score >= 25 ? '#ff7043' : '#ff1744'
    return { score, label, color }
  })()

  const r = regime ? REGIMES[regime.regime] : REGIMES.UNCERTAIN
  const regimeDuration = Math.floor(Date.now() / 1000 - regimeStart)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ background:'transparent', minHeight:'100vh', color:'#d0e8ff', fontFamily:"'IBM Plex Mono','Courier New',monospace", fontSize:13, position:'relative' }}>

      <BackgroundCanvas />

      {/* Toast notifications */}
      <div style={{ position:'fixed', top:60, right:16, zIndex:1000, display:'flex', flexDirection:'column', gap:8 }}>
        {toasts.map(t => (
          <div key={t.id} style={{ padding:'10px 16px', background:`rgba(6,13,24,0.95)`, border:`1px solid ${t.color}50`, borderLeft:`3px solid ${t.color}`, borderRadius:6, fontSize:12, color:'#d0e8ff', backdropFilter:'blur(12px)', boxShadow:`0 4px 20px rgba(0,0,0,0.4)`, animation:'slideIn 0.3s ease' }}>
            {t.message}
          </div>
        ))}
      </div>

      {/* HEADER */}
      <header style={{ position:'sticky', top:0, zIndex:100, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 20px', height:52, background:'rgba(4,8,16,0.85)', borderBottom:'1px solid rgba(0,180,255,0.15)', backdropFilter:'blur(16px)', flexWrap:'wrap', gap:8 }}>
        <div style={{ display:'flex', alignItems:'baseline', gap:10 }}>
          <span style={{ fontFamily:"'Bebas Neue','Impact',sans-serif", fontSize:22, letterSpacing:'0.1em', color:'#00d4ff', textShadow:'0 0 20px rgba(0,212,255,0.5)' }}>MACRO ORACLE</span>
          <span style={{ fontSize:9, color:'#3d6080', letterSpacing:'0.18em', textTransform:'uppercase' }}>Cross-Asset Intelligence</span>
          <span style={{ fontSize:9, color:'#ffb300', border:'1px solid rgba(255,179,0,0.3)', padding:'2px 7px', borderRadius:3, letterSpacing:'0.12em', background:'rgba(255,179,0,0.06)' }}>⬡ PYTH NETWORK</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ fontSize:9, color:'#3d6080' }}>⚡ {updateCount} updates</span>
          <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:9, color: apiStatus === 'live' ? '#00e676' : '#ffb300', border:`1px solid ${apiStatus === 'live' ? 'rgba(0,230,118,0.3)' : 'rgba(255,179,0,0.3)'}`, padding:'3px 10px', borderRadius:3, letterSpacing:'0.12em', background: apiStatus === 'live' ? 'rgba(0,230,118,0.06)' : 'rgba(255,179,0,0.06)' }}>
            <div style={{ width:6, height:6, borderRadius:'50%', background: apiStatus === 'live' ? '#00e676' : '#ffb300', animation:'pulse 1.2s ease-in-out infinite' }} />
            {apiStatus === 'live' ? 'LIVE · PYTH HERMES' : apiStatus === 'demo' ? 'DEMO MODE' : 'CONNECTING...'}
          </div>
          <span style={{ fontSize:11, color:'#3d6080' }}>{clock}</span>
        </div>
      </header>

      <div style={{ position:'relative', zIndex:1, padding:'16px', maxWidth:1600, margin:'0 auto' }}>

        {/* HERO ROW — Regime + Fear/Greed + Meters */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:16, marginBottom:16 }}>

          {/* Regime card */}
          {regime && (
            <div style={{ background:'rgba(6,13,24,0.75)', backdropFilter:'blur(16px)', border:`1px solid ${r.color}30`, borderRadius:12, padding:'20px 24px', position:'relative', overflow:'hidden' }}>
              <div style={{ position:'absolute', inset:0, background:`radial-gradient(ellipse 60% 100% at 10% 50%, ${r.bg} 0%, transparent 70%)`, pointerEvents:'none' }} />
              <div style={{ position:'relative' }}>
                <div style={{ fontSize:9, color:'#3d6080', letterSpacing:'0.2em', textTransform:'uppercase', marginBottom:8 }}>Current Macro Regime</div>
                <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:12 }}>
                  <div style={{ fontFamily:"'Bebas Neue','Impact',sans-serif", fontSize:36, color:r.color, letterSpacing:'0.06em', lineHeight:1, textShadow:`0 0 20px ${r.color}60` }}>
                    {r.icon} {r.label.toUpperCase()}
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                    <span style={{ fontSize:9, color:'#3d6080' }}>CONFIDENCE</span>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <div style={{ width:100, height:4, background:'#0e2540', borderRadius:2 }}>
                        <div style={{ width:`${regime.confidence}%`, height:'100%', background:r.color, borderRadius:2, transition:'width 0.8s ease', boxShadow:`0 0 6px ${r.color}` }} />
                      </div>
                      <span style={{ fontSize:11, color:r.color, fontWeight:700 }}>{regime.confidence}%</span>
                    </div>
                    <span style={{ fontSize:9, color:'#3d6080' }}>Active: {timeAgo(regimeStart)}</span>
                  </div>
                </div>

                {/* Narrative */}
                <p style={{ fontFamily:"'Rajdhani','Arial',sans-serif", fontSize:15, lineHeight:1.65, color:'#c0d8f0', marginBottom:12, maxWidth:600 }}>
                  {regime.narrative}
                </p>

                {/* Top signals */}
                <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:12 }}>
                  {Object.entries(regime.raw_changes || {}).slice(0, 6).map(([sym, chg]) => (
                    <span key={sym} style={{ fontSize:10, padding:'3px 8px', borderRadius:4, background:(chg as number) >= 0 ? 'rgba(0,230,118,0.1)' : 'rgba(255,68,68,0.1)', color:(chg as number) >= 0 ? '#00e676' : '#ff4444', border:`1px solid ${(chg as number) >= 0 ? 'rgba(0,230,118,0.25)' : 'rgba(255,68,68,0.25)'}` }}>
                      {sym} {(chg as number) >= 0 ? '+' : ''}{(chg as number).toFixed(2)}%
                    </span>
                  ))}
                </div>

                {/* Action buttons */}
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  <button onClick={exportBrief} style={{ fontSize:10, padding:'6px 14px', background:'rgba(0,212,255,0.08)', border:'1px solid rgba(0,212,255,0.3)', color:'#00d4ff', cursor:'pointer', borderRadius:4, fontFamily:'inherit', letterSpacing:'0.06em' }}>
                    📄 Export Brief
                  </button>
                  {publishStatus === 'idle' && <>
                    <button onClick={() => handlePublish(false)} style={{ fontSize:10, padding:'6px 14px', background:'transparent', border:'1px solid #0e2540', color:'#3d6080', cursor:'pointer', borderRadius:4, fontFamily:'inherit' }}>Preview Tweet</button>
                    <button onClick={() => handlePublish(true)} style={{ fontSize:10, padding:'6px 14px', background:'rgba(0,212,255,0.08)', border:'1px solid rgba(0,212,255,0.3)', color:'#00d4ff', cursor:'pointer', borderRadius:4, fontFamily:'inherit' }}>Publish to X →</button>
                  </>}
                  {publishStatus === 'loading' && <span style={{ fontSize:10, color:'#3d6080', padding:'6px 0' }}>Generating...</span>}
                  {publishStatus === 'done' && (
                    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                      <div style={{ fontSize:10, padding:10, background:'rgba(4,8,16,0.8)', border:'1px solid #0e2540', borderRadius:4, color:'#a0c8e0', lineHeight:1.5, whiteSpace:'pre-wrap', maxWidth:400 }}>{publishText}</div>
                      <div style={{ display:'flex', gap:6 }}>
                        <button onClick={() => navigator.clipboard.writeText(publishText)} style={{ fontSize:10, padding:'4px 10px', background:'transparent', border:'1px solid #0e2540', color:'#3d6080', cursor:'pointer', borderRadius:3, fontFamily:'inherit' }}>Copy</button>
                        <button onClick={() => setPublishStatus('idle')} style={{ fontSize:10, padding:'4px 10px', background:'transparent', border:'1px solid #0e2540', color:'#3d6080', cursor:'pointer', borderRadius:3, fontFamily:'inherit' }}>Reset</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Fear & Greed + Signal meters */}
          <div style={{ display:'flex', flexDirection:'column', gap:12, minWidth:220 }}>

            {/* Fear & Greed */}
            <div style={{ background:'rgba(6,13,24,0.75)', backdropFilter:'blur(16px)', border:`1px solid ${fearGreed.color}30`, borderRadius:12, padding:'16px 20px', textAlign:'center' }}>
              <div style={{ fontSize:9, color:'#3d6080', letterSpacing:'0.2em', textTransform:'uppercase', marginBottom:8 }}>Fear & Greed Index</div>
              <div style={{ fontFamily:"'Bebas Neue','Impact',sans-serif", fontSize:52, color:fearGreed.color, lineHeight:1, textShadow:`0 0 20px ${fearGreed.color}60` }}>
                {fearGreed.score}
              </div>
              <div style={{ fontSize:12, color:fearGreed.color, fontWeight:700, letterSpacing:'0.08em', marginTop:4 }}>{fearGreed.label}</div>
              <div style={{ marginTop:8, height:4, background:'#0e2540', borderRadius:2 }}>
                <div style={{ width:`${fearGreed.score}%`, height:'100%', background:`linear-gradient(90deg, #ff1744, #ffb300, #00e676)`, borderRadius:2 }} />
              </div>
            </div>

            {/* Signal meters */}
            <div style={{ background:'rgba(6,13,24,0.75)', backdropFilter:'blur(16px)', border:'1px solid rgba(0,180,255,0.12)', borderRadius:12, padding:'16px 20px' }}>
              <div style={{ fontSize:9, color:'#3d6080', letterSpacing:'0.2em', textTransform:'uppercase', marginBottom:12 }}>Macro Pressures</div>
              {[
                { label:'Risk Appetite', val:(regime?.signals?.crypto_avg ?? 0) + (regime?.signals?.equity_avg ?? 0), color:'#00e676' },
                { label:'Safe Haven',    val:regime?.signals?.metal_avg ?? 0,   color:'#ffd700' },
                { label:'Dollar Str',    val:regime?.signals?.dollar_str ?? 0,  color:'#00b0ff' },
                { label:'Divergence',    val:regime?.signals?.divergence ?? 0,  color:'#9945ff' },
              ].map(m => {
                const norm = Math.min(100, Math.max(0, (m.val + 3) / 6 * 100))
                return (
                  <div key={m.label} style={{ marginBottom:10 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, marginBottom:4 }}>
                      <span style={{ color:'#3d6080' }}>{m.label}</span>
                      <span style={{ color:m.color }}>{m.val >= 0 ? '+' : ''}{m.val.toFixed(2)}%</span>
                    </div>
                    <div style={{ height:3, background:'#0e2540', borderRadius:2 }}>
                      <div style={{ width:`${norm}%`, height:'100%', background:m.color, borderRadius:2, transition:'width 0.8s ease', boxShadow:`0 0 4px ${m.color}` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* 4 CATEGORY BOXES */}
        {(['crypto','metals','forex','equities'] as AssetClass[]).map(cls => {
          const meta = CLASS_META[cls]
          const feeds = FEEDS.filter(f => f.class === cls)
          return (
            <div key={cls} style={{ background:'rgba(6,13,24,0.65)', backdropFilter:'blur(12px)', border:`1px solid ${meta.color}25`, borderRadius:12, marginBottom:16, overflow:'hidden' }}>
              {/* Category header */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 18px', borderBottom:`1px solid ${meta.color}20`, background:`rgba(6,13,24,0.5)` }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ width:28, height:28, borderRadius:6, background:`${meta.color}18`, border:`1px solid ${meta.color}40`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}>{meta.icon}</div>
                  <span style={{ fontFamily:"'Bebas Neue','Impact',sans-serif", fontSize:18, color:meta.color, letterSpacing:'0.08em' }}>{meta.label}</span>
                </div>
                <span style={{ fontSize:9, color:'#3d6080', border:'1px solid #0e2540', padding:'2px 8px', borderRadius:3 }}>{feeds.length} FEEDS</span>
              </div>
              {/* Asset grid */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px, 1fr))', gap:12, padding:14 }}>
                {feeds.map(feed => (
                  <AssetCard key={feed.sym} feed={feed} d={prices[feed.sym]} h={history[feed.sym] || []} />
                ))}
              </div>
            </div>
          )
        })}

        {/* REGIME TIMELINE */}
        <div style={{ background:'rgba(6,13,24,0.65)', backdropFilter:'blur(12px)', border:'1px solid rgba(0,180,255,0.12)', borderRadius:12, padding:'18px 20px', marginBottom:16 }}>
          <div style={{ fontSize:9, color:'#3d6080', letterSpacing:'0.2em', textTransform:'uppercase', marginBottom:14 }}>Regime History Timeline</div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {(regimeHistory.length > 0 ? regimeHistory : [
              { ts:Date.now()/1000-180,  regime:'RISK_OFF'  as RegimeKey, confidence:72, narrative:'Gold +1.1% safe-haven bid. BTC and equities both under pressure.' },
              { ts:Date.now()/1000-720,  regime:'UNCERTAIN' as RegimeKey, confidence:45, narrative:'Mixed signals. No clear macro theme dominant.' },
              { ts:Date.now()/1000-1800, regime:'RISK_ON'   as RegimeKey, confidence:68, narrative:'Broad risk appetite. SPY and BTC both bid together.' },
            ]).slice(0, 8).map((event, i) => {
              const rr = REGIMES[event.regime as RegimeKey] || REGIMES.UNCERTAIN
              return (
                <div key={i} style={{ display:'grid', gridTemplateColumns:'130px 170px 1fr', gap:12, alignItems:'center', padding:'10px 14px', background:'rgba(4,8,16,0.6)', border:'1px solid #0a1826', borderRadius:6, borderLeft:`3px solid ${rr.color}` }}>
                  <div>
                    <div style={{ fontSize:10, color:'#3d6080' }}>{timeAgo(event.ts)}</div>
                    <div style={{ fontSize:9, color:'#1e3a52', marginTop:2 }}>{new Date(event.ts * 1000).toLocaleTimeString()}</div>
                  </div>
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:rr.color }}>{rr.icon} {rr.label}</div>
                    <div style={{ fontSize:9, color:'#3d6080', marginTop:2 }}>{event.confidence}% confidence</div>
                  </div>
                  <div style={{ fontSize:11, color:'#7090a8', lineHeight:1.4, fontFamily:"'Rajdhani','Arial',sans-serif" }}>{event.narrative}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* FOOTER */}
        <footer style={{ padding:'12px 0', borderTop:'1px solid #0a1826', display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:9, color:'#1e3a52', letterSpacing:'0.1em', flexWrap:'wrap', gap:8 }}>
          <span>MACRO ORACLE · Pyth Network Hackathon 2026 · Apache 2.0</span>
          <span style={{ color:'#ffb300', opacity:0.6 }}>⬡ PYTH HERMES · {FEEDS.length} ACTIVE FEEDS · 8s REFRESH</span>
        </footer>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=Bebas+Neue&family=Rajdhani:wght@400;500;600&display=swap');

        :root{
          --bg:#040810;
          --panel: rgba(6,13,24,0.55);
          --panel-strong: rgba(6,13,24,0.68);
          --border: rgba(0,212,255,0.10);
          --border-2: rgba(140,140,255,0.10);
          --text:#d0e8ff;
          --muted:#3d6080;
          --glow: rgba(0,212,255,0.14);
        }

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: var(--bg); overflow-x: hidden; max-width: 100%; }

        /* Glass */
        .glass{ -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }

        /* Background FX layers */
        .bgFx { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
        .bgMesh {
          position:absolute; inset:-20%;
          background:
            radial-gradient(800px 700px at 22% 18%, rgba(0,212,255,0.22), transparent 60%),
            radial-gradient(900px 800px at 82% 22%, rgba(120,90,255,0.16), transparent 62%),
            radial-gradient(900px 900px at 55% 82%, rgba(0,230,118,0.10), transparent 62%),
            linear-gradient(120deg, rgba(0,40,80,0.60), rgba(0,10,25,0.92));
          animation: meshShift 18s ease-in-out infinite alternate;
          will-change: transform;
        }
        @keyframes meshShift { 0%{ transform: translate3d(-2%,-1%,0) scale(1.02);} 100%{ transform: translate3d(2%,1%,0) scale(1.07);} }

        .bgOrbs{
          position:absolute; inset:0;
          background:
            radial-gradient(260px 260px at 14% 62%, rgba(0,212,255,0.20), transparent 60%),
            radial-gradient(340px 340px at 84% 58%, rgba(0,160,255,0.16), transparent 62%),
            radial-gradient(420px 420px at 55% 14%, rgba(0,140,255,0.12), transparent 65%);
          filter: blur(3px);
          animation: orbFloat 14s ease-in-out infinite;
          opacity: 1;
          will-change: transform, opacity;
        }
        @keyframes orbFloat { 0%,100%{ transform: translate3d(0,0,0); opacity:0.78;} 50%{ transform: translate3d(0,-12px,0); opacity:1;} }

        .bgCanvas{ position: fixed; top:0; left:0; width:100%; height:100%; opacity: 0.95; }
        .bgVignette{ position:absolute; inset:0; background: radial-gradient(ellipse at center, transparent 0%, rgba(4,8,16,0.50) 70%, rgba(4,8,16,0.92) 100%); }

        /* Ensure content above background */
        .app > *:not(.bgFx){ position: relative; z-index: 1; }

        /* Scrollbar */
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: var(--bg); }
        ::-webkit-scrollbar-thumb { background: #0e2540; border-radius: 3px; }

        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.3;transform:scale(0.7)} }
        @keyframes slideIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }

        /* Mobile */
        @media (max-width: 900px){
          h1{ font-size: 42px !important; }
        }
        @media (max-width: 768px) {
          header { height: auto !important; padding: 10px 12px !important; }
          .heroWrap{ padding: 18px 12px 6px !important; }
          .heroPills{ width: 100%; }
          .metricGrid{ grid-template-columns: 1fr !important; }
          .categoryBox{ border-radius: 12px !important; }
        }
        @media (prefers-reduced-motion: reduce){
          .bgMesh, .bgOrbs{ animation:none !important; }
          .bgCanvas{ display:none !important; }
        }
      `}</style>
    </div>
  )
}
