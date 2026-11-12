/**
 * Symbol conventions from Trading-R1 tools/data/symbols.py.
 * Resolves common spellings into Tauric instrument keys and routes.
 */

export type InstrumentKind = "security" | "index" | "future" | "fx" | "crypto";

export type Instrument = {
  kind: InstrumentKind;
  key: string;
  path: string;
  label: string;
  note?: string;
};

const INDEX_SERIES: Record<string, string> = {
  "^GSPC": "us.equity_index.sp500",
  "^SPX": "us.equity_index.sp500",
  "^DJI": "us.equity_index.djia",
  "^IXIC": "us.equity_index.nasdaq_composite",
  "^RUT": "us.equity_index.russell_2000",
  "^VIX": "us.volatility_index.vix",
  "^IRX": "us.treasury.yield_index.13w",
  "^FVX": "us.treasury.yield_index.5y",
  "^TNX": "us.treasury.yield_index.10y",
  "^TYX": "us.treasury.yield_index.30y",
};

const CURRENCIES = new Set(["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD"]);
const SAFE = /^[A-Za-z0-9.:/_=^-]+$/;
const CRYPTO = /^([A-Z0-9]{2,10})[-/](USDT|USDC|USD)$/;
const CRYPTO_BARE = /^([A-Z0-9]{2,10})(USDT|USDC|USD)$/;
const SHARE_CLASS = /^([A-Z]{1,5})-([A-Z])$/;
const FX = /^([A-Z]{3})[-/_]?([A-Z]{3})$/;
const TICKER = /^(?:[A-Z0-9]{4}:)?[A-Z0-9][A-Z0-9.-]*$/;

function security(ticker: string): Instrument {
  if (!TICKER.test(ticker)) {
    throw new Error(`'${ticker}' is not a symbol: use a ticker, CL=F, EURUSD=X, BTC-USD or ^GSPC`);
  }
  return {
    kind: "security",
    key: `security:${ticker}`,
    path: `/securities/${ticker}`,
    label: ticker,
  };
}

function index(series: string, label: string): Instrument {
  return {
    kind: "index",
    key: `series:${series}`,
    path: `/series/${series}`,
    label,
  };
}

function future(root: string): Instrument {
  return {
    kind: "future",
    key: `future:${root}/continuous`,
    path: `/futures/${root}/continuous`,
    label: `${root}=F`,
  };
}

function fx(pair: string): Instrument {
  return { kind: "fx", key: `fx:${pair}`, path: `/fx/${pair}`, label: pair };
}

function crypto(base: string, quote: string): Instrument {
  const served = quote === "USD" ? "USDT" : quote;
  const pair = `${base}-${served}`;
  return {
    kind: "crypto",
    key: `crypto:${pair}`,
    path: `/crypto/pairs/${pair}`,
    label: pair,
    note:
      quote === "USD"
        ? `${base}-USD is served as ${pair}: quoted in USDT, not USD`
        : undefined,
  };
}

function keyed(symbol: string): Instrument | null {
  const [kindRaw, rest] = (() => {
    const i = symbol.indexOf(":");
    if (i < 0) return [null, symbol] as const;
    return [symbol.slice(0, i).toLowerCase(), symbol.slice(i + 1)] as const;
  })();
  if (!kindRaw || !rest) return null;
  if (kindRaw === "security") return security(rest.toUpperCase());
  if (kindRaw === "series") return index(rest.toLowerCase(), symbol);
  if (kindRaw === "future") {
    const root = rest.toUpperCase().replace(/\/CONTINUOUS$/, "").split(":").pop()!;
    return future(root);
  }
  if (kindRaw === "fx") return fx(rest.toUpperCase());
  if (kindRaw === "crypto") {
    const [base, quote = "USDT"] = rest.toUpperCase().split("-");
    return crypto(base, quote);
  }
  return null;
}

/** Resolve a user/model spelling into a Tauric instrument. */
export function resolveSymbol(symbol: string): Instrument {
  const raw = symbol.trim();
  if (!SAFE.test(raw)) {
    throw new Error(`'${symbol}' is not a symbol: use a ticker, CL=F, EURUSD=X, BTC-USD or ^GSPC`);
  }
  const asKey = keyed(raw);
  if (asKey) return asKey;

  let s = raw.toUpperCase().replace(/^SECURITY:/, "");
  const micSplit = s.lastIndexOf(":");
  if (micSplit >= 0) {
    const mic = s.slice(0, micSplit);
    let ticker = s.slice(micSplit + 1);
    const m = SHARE_CLASS.exec(ticker);
    if (m) ticker = `${m[1]}.${m[2]}`;
    s = `${mic}:${ticker}`;
  } else {
    const m = SHARE_CLASS.exec(s);
    if (m) s = `${m[1]}.${m[2]}`;
  }

  if (s.startsWith("^")) {
    const series = INDEX_SERIES[s];
    if (!series) {
      throw new Error(
        `'${s}' is not a headline index here: use symbol_search to find the series key`,
      );
    }
    return index(series, s);
  }
  if (s.endsWith("=F")) return future(s.slice(0, -2));
  if (s.endsWith("=X")) {
    const pair = s.slice(0, -2);
    const m = FX.exec(pair);
    if (!m) throw new Error(`'${s}' is not an FX pair`);
    return fx(`${m[1]}${m[2]}`);
  }

  const cryptoM = CRYPTO.exec(s) || CRYPTO_BARE.exec(s);
  if (cryptoM) return crypto(cryptoM[1], cryptoM[2]);

  const fxM = FX.exec(s);
  if (fxM && CURRENCIES.has(fxM[1]) && CURRENCIES.has(fxM[2]) && fxM[1] !== fxM[2]) {
    return fx(`${fxM[1]}${fxM[2]}`);
  }

  return security(s);
}
