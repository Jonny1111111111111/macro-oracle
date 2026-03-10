export type AssetClass = 'crypto' | 'metals' | 'forex' | 'equities';

export interface FeedConfig {
  sym: string;
  name: string;
  id: string;
  class: AssetClass;
  fmt: string;
  dec: number;
  color: string;
}

export const FEEDS: FeedConfig[] = [
  // Crypto
  { sym: 'BTC',     name: 'Bitcoin',    id: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', class: 'crypto',   fmt: '$',  dec: 0,  color: '#f7931a' },
  { sym: 'ETH',     name: 'Ethereum',   id: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', class: 'crypto',   fmt: '$',  dec: 0,  color: '#627eea' },
  { sym: 'SOL',     name: 'Solana',     id: '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d', class: 'crypto',   fmt: '$',  dec: 2,  color: '#9945ff' },
  { sym: 'AVAX',    name: 'Avalanche',  id: '0x93da3352f9f1d105fdfe4971cfa80e9269ef110b2d2b9eb51a4b12f27380b8e1', class: 'crypto',   fmt: '$',  dec: 2,  color: '#e84142' },
  { sym: 'PYTH',    name: 'Pyth',       id: '0x0bbf28e9a841a1cc788f6a361b17ca072d0ea3098a1e5df1c3922d06719579ff', class: 'crypto',   fmt: '$',  dec: 4,  color: '#e6dafe' },
  // Metals & Energy
  { sym: 'XAU',     name: 'Gold',       id: '0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2', class: 'metals',   fmt: '$',  dec: 0,  color: '#ffd700' },
  { sym: 'XAG',     name: 'Silver',     id: '0xf2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e', class: 'metals',   fmt: '$',  dec: 2,  color: '#c0c0c0' },
  { sym: 'WTI',     name: 'Oil',        id: '0x0e1472f3a8ee12e3c97e5ffd72dd0d37aa12b2c04c2e1d54a9c56e749b6b59e4', class: 'metals',   fmt: '$',  dec: 2,  color: '#ff6d00' },
  { sym: 'NGAS',    name: 'Nat Gas',    id: '0xa0cf45057a91c5b3034efc3b5f7c83bada35e793d57ea50f1e1d65a4c8499fd0', class: 'metals',   fmt: '$',  dec: 3,  color: '#4fc3f7' },
  // Forex
  { sym: 'EUR/USD', name: 'Euro',       id: '0xa995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b', class: 'forex',    fmt: '',   dec: 4,  color: '#0052b4' },
  { sym: 'GBP/USD', name: 'Pound',      id: '0x84c2dde9633d93d1bcad84e7dc41c9d56578b7ec52fabedc1f335d673df0a7c1', class: 'forex',    fmt: '',   dec: 4,  color: '#00247d' },
  { sym: 'USD/JPY', name: 'Yen',        id: '0xef2c98c804ba503c6a707e38be4dfbb16683775f195b091252bf24693042fd52', class: 'forex',    fmt: '',   dec: 2,  color: '#bc002d' },
  { sym: 'USD/CNH', name: 'Yuan',       id: '0xeef52e09c878ad41f6a81803e3ba6e6fc37b04ed9cc5d7c02f7e24e41be0d421', class: 'forex',    fmt: '',   dec: 4,  color: '#de2910' },
  // Equities
  { sym: 'SPY',     name: 'S&P 500',    id: '0x2a01deaec9e51a579277b34b122399984d0bbf57e2458a7e42fecd2829867a0d', class: 'equities', fmt: '$',  dec: 0,  color: '#26a69a' },
  { sym: 'QQQ',     name: 'NASDAQ',     id: '0x3b9551a68d01d954d6387aff4df1529027ffb2fee413082e509feb29cc4904fe', class: 'equities', fmt: '$',  dec: 0,  color: '#42a5f5' },
  { sym: 'NVDA',    name: 'Nvidia',     id: '0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1', class: 'equities', fmt: '$',  dec: 0,  color: '#76b900' },
  { sym: 'TSLA',    name: 'Tesla',      id: '0x2a9ac4e2e0ce6c29bce6d27f37c05e94e64c4e45b5f43562e52e3cbdc0e7e8e5', class: 'equities', fmt: '$',  dec: 0,  color: '#cc0000' },
];

export type RegimeKey = 'RISK_OFF' | 'RISK_ON' | 'DXY_SURGE' | 'CRYPTO_DEC' | 'COMM_CYCLE' | 'UNCERTAIN';

export interface RegimeInfo {
  key: RegimeKey;
  label: string;
  color: string;
  bg: string;
  description: string;
}

export const REGIMES: Record<RegimeKey, RegimeInfo> = {
  RISK_OFF:   { key: 'RISK_OFF',   label: 'Risk-Off',            color: '#ff4444', bg: 'rgba(255,68,68,0.08)',    description: 'Safe haven demand. Flight from risk assets into gold and bonds.' },
  RISK_ON:    { key: 'RISK_ON',    label: 'Risk-On',             color: '#00e676', bg: 'rgba(0,230,118,0.08)',   description: 'Broad risk appetite. Equities and crypto bid together.' },
  DXY_SURGE:  { key: 'DXY_SURGE', label: 'Dollar Surge',         color: '#ffb300', bg: 'rgba(255,179,0,0.08)',   description: 'Dollar strengthening. Pressure on commodities and EM assets.' },
  CRYPTO_DEC: { key: 'CRYPTO_DEC',label: 'Crypto Decoupling',    color: '#00b0ff', bg: 'rgba(0,176,255,0.08)',   description: 'Crypto diverging from traditional markets. Onchain narrative dominant.' },
  COMM_CYCLE: { key: 'COMM_CYCLE',label: 'Commodity Cycle',      color: '#ff6d00', bg: 'rgba(255,109,0,0.08)',   description: 'Real asset inflation bid. Metals and energy moving in unison.' },
  UNCERTAIN:  { key: 'UNCERTAIN', label: 'Uncertain',            color: '#78909c', bg: 'rgba(120,144,156,0.08)', description: 'Mixed signals across asset classes. No dominant macro theme.' },
};
