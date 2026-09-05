import type { Address } from "viem";

/**
 * Coinbase tokenized stocks, live natively on Base since 2026-08-24.
 *
 * These are B20 Asset tokens — implemented as Base protocol precompiles, not
 * deployed ERC-20 contracts. Their addresses are deterministic and encode the
 * B20 variant in the prefix (`0xb200…` = Asset, `0xb201…` = Stablecoin).
 *
 * Each token is backed 1:1 by a real share held in regulated custody (Alpaca,
 * under the ADGM framework) and carries dividend and voting rights.
 *
 * IMPORTANT: one token does not permanently equal one share. Corporate actions
 * move the B20 multiplier, so always go through `scaledBalanceOf` / the
 * multiplier helpers in `./b20` when converting units to shares. See
 * https://docs.base.org/specifications/b20/tokenized-stocks-on-base
 */
export type Stock = {
  /** Onchain B20 symbol, e.g. "AAPLc". */
  symbol: string;
  /** Underlying equity ticker, e.g. "AAPL". */
  ticker: string;
  name: string;
  /** B20 Asset precompile address on Base mainnet. */
  address: Address;
  /** Chainlink 24/5 total-return price feed (8 decimals). */
  feed: Address;
  /** Broad sector, used for slate templates and filtering. */
  sector: Sector;
  /** Short brand color, used for chips and the allocation ring. */
  color: string;
};

export type Sector = "tech" | "ai" | "consumer" | "crypto" | "space";

export const STOCKS: readonly Stock[] = [
  {
    symbol: "AAPLc",
    ticker: "AAPL",
    name: "Apple",
    address: "0xb200000000000000000000c2e324d24d7eecd1fb",
    feed: "0x787f13dEa48Db0897CbCDD985de77809D837F988",
    sector: "tech",
    color: "#a3aab4",
  },
  {
    symbol: "NVDAc",
    ticker: "NVDA",
    name: "NVIDIA",
    address: "0xb20000000000000000000078ee7ce2fe4908108c",
    feed: "0x04689a41629776563E6822F76f2e57D148d28513",
    sector: "ai",
    color: "#76b900",
  },
  {
    symbol: "MSFTc",
    ticker: "MSFT",
    name: "Microsoft",
    address: "0xb200000000000000000000ab99cfa739e253872b",
    feed: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c",
    sector: "tech",
    color: "#4b9ae5",
  },
  {
    symbol: "GOOGLc",
    ticker: "GOOGL",
    name: "Alphabet",
    address: "0xb2000000000000000000002d0ba3164cc74f58b7",
    feed: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2",
    sector: "ai",
    color: "#e8973f",
  },
  {
    symbol: "METAc",
    ticker: "META",
    name: "Meta Platforms",
    address: "0xb2000000000000000000008bc8786b856e61707c",
    feed: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D",
    sector: "ai",
    color: "#4a7dff",
  },
  {
    symbol: "AMZNc",
    ticker: "AMZN",
    name: "Amazon",
    address: "0xb200000000000000000000d9192b6b456483c2e8",
    feed: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295",
    sector: "consumer",
    color: "#ff9900",
  },
  {
    symbol: "TSLAc",
    ticker: "TSLA",
    name: "Tesla",
    address: "0xb2000000000000000000001e800a7f5189430cd0",
    feed: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4",
    sector: "consumer",
    color: "#e82127",
  },
  {
    symbol: "COINc",
    ticker: "COIN",
    name: "Coinbase",
    address: "0xb200000000000000000000c85a31389d71f3ecfb",
    feed: "0x408e44f504A7371a345F03a73dDC96A4b48e8aa7",
    sector: "crypto",
    color: "#0052ff",
  },
  {
    symbol: "CRCLc",
    ticker: "CRCL",
    name: "Circle",
    address: "0xb20000000000000000000019f6e7c675b73c2e4d",
    feed: "0x0231cF2635D1E17bB5c2462cc7504Ba1fBd61f33",
    sector: "crypto",
    color: "#3ec78a",
  },
  {
    symbol: "MSTRc",
    ticker: "MSTR",
    name: "Strategy",
    address: "0xb2000000000000000000004884b426556b92883d",
    feed: "0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a",
    sector: "crypto",
    color: "#f7931a",
  },
  {
    symbol: "INTCc",
    ticker: "INTC",
    name: "Intel",
    address: "0xb2000000000000000000004aff16039ba04bdfbc",
    feed: "0xAB657C39bac0D5886250D70849e2E3E008F2EECB",
    sector: "tech",
    color: "#0f7dc2",
  },
  {
    symbol: "SNDKc",
    ticker: "SNDK",
    name: "SanDisk",
    address: "0xb200000000000000000000397293cb8cda9a10c5",
    feed: "0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA",
    sector: "tech",
    color: "#d63426",
  },
  {
    symbol: "SPCXc",
    ticker: "SPCX",
    name: "SpaceX",
    address: "0xb2000000000000000000007b9fcbd005511acbd5",
    feed: "0x6A634B235903C4ad6376892180d6fF8612e3Fa68",
    sector: "space",
    color: "#8b93ff",
  },
] as const;

const BY_SYMBOL = new Map(STOCKS.map((s) => [s.symbol.toLowerCase(), s]));
const BY_ADDRESS = new Map(STOCKS.map((s) => [s.address.toLowerCase(), s]));

export function stockBySymbol(symbol: string): Stock | undefined {
  return BY_SYMBOL.get(symbol.toLowerCase());
}

export function stockByAddress(address: string): Stock | undefined {
  return BY_ADDRESS.get(address.toLowerCase());
}

/** Throws on an unknown symbol — use at trust boundaries that must not guess. */
export function requireStock(symbol: string): Stock {
  const stock = stockBySymbol(symbol);
  if (!stock) throw new Error(`Unknown tokenized stock: ${symbol}`);
  return stock;
}

export const SECTOR_LABELS: Record<Sector, string> = {
  tech: "Tech",
  ai: "AI",
  consumer: "Consumer",
  crypto: "Crypto",
  space: "Space",
};
