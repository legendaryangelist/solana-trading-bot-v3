import { createHash } from 'crypto';
import { PublicKey } from '@solana/web3.js';

export interface PumpCreateEvent {
  mint: PublicKey;
  bondingCurve: PublicKey;
  user: PublicKey;
  creator: PublicKey;
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  tokenTotalSupply: bigint;
  tokenProgram: PublicKey;
  isMayhemMode: boolean;
  quoteMint: PublicKey;
  virtualQuoteReserves: bigint;
  creatorFeeBps: bigint;
}

export interface PumpTradeEvent {
  mint: PublicKey;
  isBuy: boolean;
  user: PublicKey;
}

export interface CreatePoolEvent {
  creator: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  pool: PublicKey;
  coinCreator: PublicKey;
  creatorFeeBps: bigint;
  isMayhemMode: boolean;
}

function eventDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`event:${name}`).digest().subarray(0, 8);
}

const CREATE_EVENT = [eventDiscriminator('CreateEvent')];
const TRADE_EVENT = [eventDiscriminator('TradeEvent')];
const CREATE_POOL_EVENT = [eventDiscriminator('CreatePoolEvent')];

function matches(data: Buffer, discs: Buffer[]): boolean {
  const head = data.subarray(0, 8);
  return discs.some((disc) => head.equals(disc));
}

function readString(data: Buffer, offset: number): { value: string; offset: number } | null {
  if (offset + 4 > data.length) {
    return null;
  }
  const length = data.readUInt32LE(offset);
  const start = offset + 4;
  if (length > 10_000 || start + length > data.length) {
    return null;
  }
  return { value: data.subarray(start, start + length).toString('utf8'), offset: start + length };
}

export function parseCreateEvent(data: Buffer): PumpCreateEvent | null {
  try {
    return parseCreateEventUnchecked(data);
  } catch {
    return null;
  }
}

function parseCreateEventUnchecked(data: Buffer): PumpCreateEvent | null {
  if (!matches(data, CREATE_EVENT)) {
    return null;
  }
  let offset = 8;
  for (let i = 0; i < 3; i++) {
    const field = readString(data, offset);
    if (!field) {
      return null;
    }
    offset = field.offset;
  }
  if (offset + 32 * 4 + 8 + 8 * 4 + 32 + 2 + 32 + 16 > data.length) {
    return null;
  }
  const mint = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const bondingCurve = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const user = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const creator = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  offset += 8; // timestamp
  const virtualTokenReserves = data.readBigUInt64LE(offset);
  offset += 8;
  const virtualSolReserves = data.readBigUInt64LE(offset);
  offset += 8;
  const realTokenReserves = data.readBigUInt64LE(offset);
  offset += 8;
  const tokenTotalSupply = data.readBigUInt64LE(offset);
  offset += 8;
  const tokenProgram = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const isMayhemMode = data[offset] === 1;
  offset += 1;
  offset += 1; // isCashbackEnabled
  const quoteMint = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const virtualQuoteReserves = data.readBigUInt64LE(offset);
  offset += 8;
  const creatorFeeBps = data.readBigUInt64LE(offset);
  return {
    mint,
    bondingCurve,
    user,
    creator,
    virtualTokenReserves,
    virtualSolReserves,
    realTokenReserves,
    tokenTotalSupply,
    tokenProgram,
    isMayhemMode,
    quoteMint,
    virtualQuoteReserves,
    creatorFeeBps,
  };
}

export function parseTradeEvent(data: Buffer): PumpTradeEvent | null {
  if (!matches(data, TRADE_EVENT) || data.length < 8 + 32 + 8 + 8 + 1 + 32) {
    return null;
  }
  const mint = new PublicKey(data.subarray(8, 40));
  const isBuy = data[8 + 32 + 8 + 8] === 1;
  const user = new PublicKey(data.subarray(8 + 32 + 8 + 8 + 1, 8 + 32 + 8 + 8 + 1 + 32));
  return { mint, isBuy, user };
}

export function parseCreatePoolEvent(data: Buffer): CreatePoolEvent | null {
  if (!matches(data, CREATE_POOL_EVENT)) {
    return null;
  }
  // timestamp i64, index u16, creator, baseMint, quoteMint, decimals, amounts..., poolBump, pool, lpMint, user atas, coinCreator, mayhem, creatorFeeBps
  let offset = 8 + 8 + 2;
  if (data.length < offset + 32 * 3 + 2) {
    return null;
  }
  const creator = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const baseMint = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const quoteMint = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  offset += 2; // decimals
  offset += 8 * 7; // base/quote in, pool amounts, liquidity, lp tokens
  offset += 1; // pool bump
  if (data.length < offset + 32 * 5 + 1 + 8) {
    return null;
  }
  const pool = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  offset += 32; // lpMint
  offset += 32; // userBase
  offset += 32; // userQuote
  const coinCreator = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const isMayhemMode = data[offset] === 1;
  offset += 1;
  const creatorFeeBps = data.readBigUInt64LE(offset);
  return { creator, baseMint, quoteMint, pool, coinCreator, creatorFeeBps, isMayhemMode };
}

export function decodeProgramDataLogs(lines: string[]): Buffer[] {
  const buffers: Buffer[] = [];
  for (const line of lines) {
    const marker = 'Program data: ';
    if (!line.startsWith(marker)) {
      continue;
    }
    try {
      buffers.push(Buffer.from(line.slice(marker.length), 'base64'));
    } catch {
      // Ignore truncated log lines.
    }
  }
  return buffers;
}
