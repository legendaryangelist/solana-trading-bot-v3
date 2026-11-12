import { Connection, PublicKey } from '@solana/web3.js';
import { MintLayout } from '@solana/spl-token';
import { getPdaMetadataKey } from '@raydium-io/raydium-sdk';
import { getMetadataAccountDataSerializer } from '@metaplex-foundation/mpl-token-metadata';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';

const metadataSerializer = getMetadataAccountDataSerializer();

export function isTokenProgram(programId: PublicKey): boolean {
  return programId.equals(TOKEN_PROGRAM_ID) || programId.equals(TOKEN_2022_PROGRAM_ID);
}

export interface MintFlags {
  renounced: boolean;
  freezable: boolean;
  mutable: boolean;
}

export async function readMintFlags(connection: Connection, mint: PublicKey): Promise<MintFlags | null> {
  const info = await connection.getAccountInfo(mint, connection.commitment);
  if (!info) {
    return null;
  }

  const decoded = MintLayout.decode(info.data);
  // Token-2022 pump coins keep metadata on the mint, not in a Metaplex account.
  // A missing Metaplex account is not mutable metadata.
  let mutable = false;
  try {
    const metadataPda = getPdaMetadataKey(mint);
    const metadata = await connection.getAccountInfo(metadataPda.publicKey, connection.commitment);
    if (metadata) {
      mutable = metadataSerializer.deserialize(metadata.data)[0].isMutable;
    }
  } catch {
    mutable = false;
  }

  return {
    renounced: decoded.mintAuthorityOption === 0,
    freezable: decoded.freezeAuthorityOption !== 0,
    mutable,
  };
}
