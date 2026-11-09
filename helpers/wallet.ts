import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { mnemonicToSeedSync, validateMnemonic } from 'bip39';
import { derivePath } from 'ed25519-hd-key';

const SOLANA_DERIVATION_PATH = `m/44'/501'/0'/0'`;

/**
 * Build a keypair from a base58 secret key, a JSON array of 64 bytes, or a
 * 12/24-word BIP-39 phrase. The secret is never written to the logger.
 * Mnemonic derivation matches upstream (m/44'/501'/0'/0').
 */
export function getWallet(wallet: string): Keypair {
  const trimmed = wallet.trim();
  if (!trimmed) {
    throw new Error('PRIVATE_KEY is empty.');
  }

  if (trimmed.startsWith('[')) {
    return keypairFromByteArray(trimmed);
  }

  if (trimmed.includes(' ')) {
    return keypairFromMnemonic(trimmed);
  }

  return keypairFromBase58(trimmed);
}

function keypairFromByteArray(rawJson: string): Keypair {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('PRIVATE_KEY starts with "[" but is not a JSON array of 64 bytes. The value was not logged.');
  }

  if (!Array.isArray(parsed) || parsed.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error('PRIVATE_KEY JSON must be an array of integers from 0 to 255. The value was not logged.');
  }

  return fromSecretBytes(Uint8Array.from(parsed as number[]), 'JSON array');
}

function keypairFromMnemonic(phrase: string): Keypair {
  const normalized = phrase.trim().replace(/\s+/g, ' ');
  const words = normalized.split(' ');
  if (words.length !== 12 && words.length !== 24) {
    throw new Error(
      `PRIVATE_KEY looks like a seed phrase (${words.length} words). Solana phrases are 12 or 24 words. The phrase was not logged.`,
    );
  }

  if (!validateMnemonic(normalized)) {
    throw new Error('PRIVATE_KEY looks like a seed phrase but failed BIP-39 validation. The phrase was not logged.');
  }

  const seed = mnemonicToSeedSync(normalized);
  const derived = derivePath(SOLANA_DERIVATION_PATH, seed.toString('hex')).key;
  return Keypair.fromSeed(Uint8Array.from(derived));
}

function keypairFromBase58(value: string): Keypair {
  let decoded: Uint8Array;
  try {
    decoded = bs58.decode(value);
  } catch {
    throw new Error(
      'PRIVATE_KEY is not valid base58. Use a base58 secret key (about 88 characters), a JSON array of 64 bytes, or a 12/24-word seed phrase. The value was not logged.',
    );
  }

  return fromSecretBytes(decoded, 'base58');
}

function fromSecretBytes(bytes: Uint8Array, source: string): Keypair {
  if (bytes.length === 32) {
    throw new Error(
      `PRIVATE_KEY (${source}) decoded to 32 bytes. That is a public key, not a secret key. Paste the base58 secret key (64 bytes, about 88 characters) or a JSON array of 64 numbers. The value was not logged.`,
    );
  }

  if (bytes.length !== 64) {
    throw new Error(
      `PRIVATE_KEY (${source}) decoded to ${bytes.length} bytes. A Solana secret key is 64 bytes. The value was not logged.`,
    );
  }

  return Keypair.fromSecretKey(bytes);
}
