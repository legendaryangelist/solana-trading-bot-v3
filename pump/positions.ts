import { PublicKey } from '@solana/web3.js';

export interface PumpPosition {
  venue: 'pump';
  mint: PublicKey;
  bondingCurve: PublicKey;
  quoteMint: PublicKey;
  baseTokenProgram: PublicKey;
  creator: PublicKey;
  initialRealTokenReserves: bigint;
}

export interface PumpSwapPosition {
  venue: 'pumpswap';
  mint: PublicKey;
  pool: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  poolBaseTokenAccount: PublicKey;
  poolQuoteTokenAccount: PublicKey;
  baseTokenProgram: PublicKey;
  quoteTokenProgram: PublicKey;
  coinCreator: PublicKey;
  creatorFeeBps: bigint;
  virtualQuoteReserves: bigint;
}

export type Position = PumpPosition | PumpSwapPosition;

export class PositionBook {
  private readonly byMint = new Map<string, Position>();

  set(position: Position) {
    this.byMint.set(position.mint.toBase58(), position);
  }

  get(mint: string): Position | undefined {
    return this.byMint.get(mint);
  }

  delete(mint: string) {
    this.byMint.delete(mint);
  }
}
