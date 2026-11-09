import { PublicKey } from '@solana/web3.js';

export interface BondingCurveAccount {
  virtualTokenReserves: bigint;
  virtualQuoteReserves: bigint;
  realTokenReserves: bigint;
  realQuoteReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  creator: PublicKey;
  isMayhemMode: boolean;
  isCashbackCoin: boolean;
  quoteMint: PublicKey;
  creatorFeeBps: bigint;
}

export interface PumpGlobalAccount {
  feeRecipient: PublicKey;
  initialVirtualTokenReserves: bigint;
  initialVirtualSolReserves: bigint;
  initialRealTokenReserves: bigint;
  tokenTotalSupply: bigint;
  feeBasisPoints: bigint;
  creatorFeeBasisPoints: bigint;
  buybackFeeRecipients: PublicKey[];
}

export interface PumpSwapPoolAccount {
  creator: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  poolBaseTokenAccount: PublicKey;
  poolQuoteTokenAccount: PublicKey;
  coinCreator: PublicKey;
  isMayhemMode: boolean;
  virtualQuoteReserves: bigint;
  creatorFeeBps: bigint;
}

export interface PumpAmmGlobalAccount {
  buybackFeeRecipients: PublicKey[];
}

function readU64(data: Buffer, offset: number): bigint {
  return data.readBigUInt64LE(offset);
}

function readBool(data: Buffer, offset: number): boolean {
  return data[offset] === 1;
}

function readPubkey(data: Buffer, offset: number): PublicKey {
  return new PublicKey(data.subarray(offset, offset + 32));
}

function readI128(data: Buffer, offset: number): bigint {
  const lo = data.readBigUInt64LE(offset);
  const hi = data.readBigInt64LE(offset + 8);
  return (hi << 64n) + lo;
}

function readPubkeyList(data: Buffer, offset: number, count: number): PublicKey[] {
  const keys: PublicKey[] = [];
  for (let i = 0; i < count; i++) {
    const key = readPubkey(data, offset + i * 32);
    if (!key.equals(PublicKey.default)) {
      keys.push(key);
    }
  }
  return keys;
}

/** Borsh layout of the bondingCurve account, after the 8-byte discriminator. */
export function decodeBondingCurve(data: Buffer): BondingCurveAccount | null {
  // 8-byte discriminator plus fields through `creator`. Longer tails are optional.
  if (data.length < 8 + 73) {
    return null;
  }
  const o = 8;
  const quoteMint = data.length >= o + 107 ? readPubkey(data, o + 75) : PublicKey.default;
  const creatorFeeBps = data.length >= o + 115 ? readU64(data, o + 107) : 0n;
  return {
    virtualTokenReserves: readU64(data, o),
    virtualQuoteReserves: readU64(data, o + 8),
    realTokenReserves: readU64(data, o + 16),
    realQuoteReserves: readU64(data, o + 24),
    tokenTotalSupply: readU64(data, o + 32),
    complete: readBool(data, o + 40),
    creator: readPubkey(data, o + 41),
    isMayhemMode: data.length > o + 73 ? readBool(data, o + 73) : false,
    isCashbackCoin: data.length > o + 74 ? readBool(data, o + 74) : false,
    quoteMint,
    creatorFeeBps,
  };
}

/** Borsh layout of Global. Buyback recipients exist only on the current extended account. */
export function decodePumpGlobal(data: Buffer): PumpGlobalAccount | null {
  const o = 8;
  if (data.length < o + 162) {
    return null;
  }
  const buybackFeeRecipients = data.length >= o + 733 + 256 ? readPubkeyList(data, o + 733, 8) : [];
  return {
    feeRecipient: readPubkey(data, o + 33),
    initialVirtualTokenReserves: readU64(data, o + 65),
    initialVirtualSolReserves: readU64(data, o + 73),
    initialRealTokenReserves: readU64(data, o + 81),
    tokenTotalSupply: readU64(data, o + 89),
    feeBasisPoints: readU64(data, o + 97),
    creatorFeeBasisPoints: readU64(data, o + 146),
    buybackFeeRecipients,
  };
}

export function decodePumpSwapPool(data: Buffer): PumpSwapPoolAccount | null {
  const o = 8;
  if (data.length < o + 261) {
    return null;
  }
  return {
    creator: readPubkey(data, o + 3),
    baseMint: readPubkey(data, o + 35),
    quoteMint: readPubkey(data, o + 67),
    poolBaseTokenAccount: readPubkey(data, o + 131),
    poolQuoteTokenAccount: readPubkey(data, o + 163),
    coinCreator: readPubkey(data, o + 203),
    isMayhemMode: readBool(data, o + 235),
    virtualQuoteReserves: data.length >= o + 253 ? readI128(data, o + 237) : 0n,
    creatorFeeBps: readU64(data, o + 253),
  };
}

export function decodePumpAmmGlobal(data: Buffer): PumpAmmGlobalAccount | null {
  const o = 8;
  if (data.length < o + 635 + 256) {
    return null;
  }
  return {
    buybackFeeRecipients: readPubkeyList(data, o + 635, 8),
  };
}
