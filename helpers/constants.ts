import { Logger } from 'pino'; 
import dotenv from 'dotenv';
import { Commitment } from '@solana/web3.js';
import { logger } from './logger';

dotenv.config();

const retrieveEnvVariable = (variableName: string, logger: Logger) => {
  const variable = process.env[variableName] || '';
  if (!variable) {
    logger.error(`${variableName} is not set`);
    process.exit(1);
  }
  return variable;
};

const envBool = (name: string, fallback: boolean) => {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  return value.trim().toLowerCase() === 'true';
};

const envNum = (name: string, fallback: number) => {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const envStr = (name: string, fallback: string) => {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  return value.trim();
};

// Wallet
export const PRIVATE_KEY = retrieveEnvVariable('PRIVATE_KEY', logger);

// Connection
export const NETWORK = 'mainnet-beta';
export const COMMITMENT_LEVEL: Commitment = retrieveEnvVariable('COMMITMENT_LEVEL', logger) as Commitment;
export const RPC_ENDPOINT = retrieveEnvVariable('RPC_ENDPOINT', logger);
export const RPC_WEBSOCKET_ENDPOINT = retrieveEnvVariable('RPC_WEBSOCKET_ENDPOINT', logger);

// Bot
export const LOG_LEVEL = retrieveEnvVariable('LOG_LEVEL', logger);
export const ONE_TOKEN_AT_A_TIME = retrieveEnvVariable('ONE_TOKEN_AT_A_TIME', logger) === 'true';
export const COMPUTE_UNIT_LIMIT = Number(retrieveEnvVariable('COMPUTE_UNIT_LIMIT', logger));
export const COMPUTE_UNIT_PRICE = Number(retrieveEnvVariable('COMPUTE_UNIT_PRICE', logger));
export const PRE_LOAD_EXISTING_MARKETS = retrieveEnvVariable('PRE_LOAD_EXISTING_MARKETS', logger) === 'true';
export const CACHE_NEW_MARKETS = retrieveEnvVariable('CACHE_NEW_MARKETS', logger) === 'true';
export const TRANSACTION_EXECUTOR = retrieveEnvVariable('TRANSACTION_EXECUTOR', logger);
export const CUSTOM_FEE = retrieveEnvVariable('CUSTOM_FEE', logger);

// Buy
export const AUTO_BUY_DELAY = Number(retrieveEnvVariable('AUTO_BUY_DELAY', logger));
export const QUOTE_MINT = retrieveEnvVariable('QUOTE_MINT', logger);
export const QUOTE_AMOUNT = retrieveEnvVariable('QUOTE_AMOUNT', logger);
export const MAX_BUY_RETRIES = Number(retrieveEnvVariable('MAX_BUY_RETRIES', logger));
export const BUY_SLIPPAGE = Number(retrieveEnvVariable('BUY_SLIPPAGE', logger));

// Sell
export const AUTO_SELL = retrieveEnvVariable('AUTO_SELL', logger) === 'true';
export const AUTO_SELL_DELAY = Number(retrieveEnvVariable('AUTO_SELL_DELAY', logger));
export const MAX_SELL_RETRIES = Number(retrieveEnvVariable('MAX_SELL_RETRIES', logger));
export const TAKE_PROFIT = Number(retrieveEnvVariable('TAKE_PROFIT', logger));
export const STOP_LOSS = Number(retrieveEnvVariable('STOP_LOSS', logger));
export const PRICE_CHECK_INTERVAL = Number(retrieveEnvVariable('PRICE_CHECK_INTERVAL', logger));
export const PRICE_CHECK_DURATION = Number(retrieveEnvVariable('PRICE_CHECK_DURATION', logger));
export const SELL_SLIPPAGE = Number(retrieveEnvVariable('SELL_SLIPPAGE', logger));

// Filters
export const FILTER_CHECK_INTERVAL = Number(retrieveEnvVariable('FILTER_CHECK_INTERVAL', logger));
export const FILTER_CHECK_DURATION = Number(retrieveEnvVariable('FILTER_CHECK_DURATION', logger));
export const CONSECUTIVE_FILTER_MATCHES = Number(retrieveEnvVariable('CONSECUTIVE_FILTER_MATCHES', logger));
export const CHECK_IF_MUTABLE = retrieveEnvVariable('CHECK_IF_MUTABLE', logger) === 'true';
export const CHECK_IF_SOCIALS = retrieveEnvVariable('CHECK_IF_SOCIALS', logger) === 'true';
export const CHECK_IF_MINT_IS_RENOUNCED = retrieveEnvVariable('CHECK_IF_MINT_IS_RENOUNCED', logger) === 'true';
export const CHECK_IF_FREEZABLE = retrieveEnvVariable('CHECK_IF_FREEZABLE', logger) === 'true';
export const CHECK_IF_BURNED = retrieveEnvVariable('CHECK_IF_BURNED', logger) === 'true';
export const MIN_POOL_SIZE = retrieveEnvVariable('MIN_POOL_SIZE', logger);
export const MAX_POOL_SIZE = retrieveEnvVariable('MAX_POOL_SIZE', logger);
export const USE_SNIPE_LIST = retrieveEnvVariable('USE_SNIPE_LIST', logger) === 'true';
export const SNIPE_LIST_REFRESH_INTERVAL = Number(retrieveEnvVariable('SNIPE_LIST_REFRESH_INTERVAL', logger));

// Execution and venues. Missing values keep the defaults so an older .env still loads.
export const DRY_RUN = envBool('DRY_RUN', false);
export const ENABLE_RAYDIUM = envBool('ENABLE_RAYDIUM', true);
// Off unless set, so an older .env does not start buying pump.fun tokens.
export const ENABLE_PUMPFUN = envBool('ENABLE_PUMPFUN', false);
export const ENABLE_PUMPSWAP = envBool('ENABLE_PUMPSWAP', false);
export const CLOSE_EMPTY_TOKEN_ACCOUNTS = envBool('CLOSE_EMPTY_TOKEN_ACCOUNTS', true);
export const PRICE_CHECK_WEBSOCKET = envBool('PRICE_CHECK_WEBSOCKET', true);
export const RETRY_BACKOFF_MS = envNum('RETRY_BACKOFF_MS', 400);
export const SELL_SLIPPAGE_STEP = envNum('SELL_SLIPPAGE_STEP', 10);

// pump.fun filters. 0 disables a numeric bound, except curve progress max which defaults to 100.
export const PUMP_MIN_CURVE_PROGRESS = envNum('PUMP_MIN_CURVE_PROGRESS', 0);
export const PUMP_MAX_CURVE_PROGRESS = envNum('PUMP_MAX_CURVE_PROGRESS', 100);
export const PUMP_MIN_MARKET_CAP_SOL = envNum('PUMP_MIN_MARKET_CAP_SOL', 0);
export const PUMP_MAX_MARKET_CAP_SOL = envNum('PUMP_MAX_MARKET_CAP_SOL', 0);
export const PUMP_MIN_DEV_BUY_SOL = envNum('PUMP_MIN_DEV_BUY_SOL', 0);
export const PUMP_MAX_DEV_BUY_SOL = envNum('PUMP_MAX_DEV_BUY_SOL', 0);
export const PUMP_MAX_CREATOR_HOLD_PERCENT = envNum('PUMP_MAX_CREATOR_HOLD_PERCENT', 0);
export const PUMP_MIN_UNIQUE_BUYERS = envNum('PUMP_MIN_UNIQUE_BUYERS', 0);
export const PUMP_BUYER_WAIT_MS = envNum('PUMP_BUYER_WAIT_MS', 0);
export const PUMP_MAX_REAL_SOL = envNum('PUMP_MAX_REAL_SOL', 0);
export const PUMP_SKIP_MAYHEM = envBool('PUMP_SKIP_MAYHEM', true);
// Token-2022 pump coins do not use Metaplex metadata. The Raydium mutable check
// rejects them, so pump has its own switch and it defaults off.
export const PUMP_CHECK_IF_MUTABLE = envBool('PUMP_CHECK_IF_MUTABLE', false);
export const PUMP_ALLOW_NON_SOL_QUOTE = envBool('PUMP_ALLOW_NON_SOL_QUOTE', false);
export const PUMP_CREATOR_BLACKLIST = envStr('PUMP_CREATOR_BLACKLIST', 'pump-creator-blacklist.txt');
