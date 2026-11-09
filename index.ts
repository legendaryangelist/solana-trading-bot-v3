import { MarketCache, PoolCache } from './cache';
import { Listeners } from './listeners';
import { Connection, KeyedAccountInfo, Keypair } from '@solana/web3.js';
import { LIQUIDITY_STATE_LAYOUT_V4, MARKET_STATE_LAYOUT_V3, Token, TokenAmount } from '@raydium-io/raydium-sdk';
import { AccountLayout, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Bot, BotConfig } from './bot';
import { DefaultTransactionExecutor, TransactionExecutor } from './transactions';
import {
  getToken,
  getWallet,
  logger,
  COMMITMENT_LEVEL,
  RPC_ENDPOINT,
  RPC_WEBSOCKET_ENDPOINT,
  PRE_LOAD_EXISTING_MARKETS,
  LOG_LEVEL,
  CHECK_IF_MUTABLE,
  CHECK_IF_MINT_IS_RENOUNCED,
  CHECK_IF_FREEZABLE,
  CHECK_IF_BURNED,
  QUOTE_MINT,
  MAX_POOL_SIZE,
  MIN_POOL_SIZE,
  QUOTE_AMOUNT,
  PRIVATE_KEY,
  USE_SNIPE_LIST,
  ONE_TOKEN_AT_A_TIME,
  AUTO_SELL_DELAY,
  MAX_SELL_RETRIES,
  AUTO_SELL,
  MAX_BUY_RETRIES,
  AUTO_BUY_DELAY,
  COMPUTE_UNIT_LIMIT,
  COMPUTE_UNIT_PRICE,
  CACHE_NEW_MARKETS,
  TAKE_PROFIT,
  STOP_LOSS,
  BUY_SLIPPAGE,
  SELL_SLIPPAGE,
  PRICE_CHECK_DURATION,
  PRICE_CHECK_INTERVAL,
  SNIPE_LIST_REFRESH_INTERVAL,
  TRANSACTION_EXECUTOR,
  CUSTOM_FEE,
  FILTER_CHECK_INTERVAL,
  FILTER_CHECK_DURATION,
  CONSECUTIVE_FILTER_MATCHES,
  DRY_RUN,
  ENABLE_RAYDIUM,
  ENABLE_PUMPFUN,
  ENABLE_PUMPSWAP,
  CLOSE_EMPTY_TOKEN_ACCOUNTS,
  PRICE_CHECK_WEBSOCKET,
  RETRY_BACKOFF_MS,
  SELL_SLIPPAGE_STEP,
  PUMP_MIN_CURVE_PROGRESS,
  PUMP_MAX_CURVE_PROGRESS,
  PUMP_MIN_MARKET_CAP_SOL,
  PUMP_MAX_MARKET_CAP_SOL,
  PUMP_MIN_DEV_BUY_SOL,
  PUMP_MAX_DEV_BUY_SOL,
  PUMP_MAX_CREATOR_HOLD_PERCENT,
  PUMP_MIN_UNIQUE_BUYERS,
  PUMP_BUYER_WAIT_MS,
  PUMP_MAX_REAL_SOL,
  PUMP_SKIP_MAYHEM,
  PUMP_ALLOW_NON_SOL_QUOTE,
  PUMP_CREATOR_BLACKLIST,
} from './helpers';
import { version } from './package.json';
import { WarpTransactionExecutor } from './transactions/warp-transaction-executor';
import { JitoTransactionExecutor } from './transactions/jito-rpc-transaction-executor';
import { DryRunTransactionExecutor } from './transactions/dry-run-transaction-executor';
import { BuyerTracker, CreatorBlacklist } from './pump/tracking';

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: COMMITMENT_LEVEL,
});

function printDetails(wallet: Keypair, quoteToken: Token, bot: Bot) {
  logger.info(`

          ██     ██    █████    ██████    ██████  
          ██     ██   ██   ██   ██   ██   ██   ██ 
          ██  █  ██   ███████   ██████    ██████  
          ██ ███ ██   ██   ██   ██   ██   ██      
          ███ ███ ██  ██   ██   ██████    ██      
                                     
     
               🚀 WARP DRIVE ACTIVATED 🚀
                 Made with ❤️ by humans 
                  Version: ${version}
    `);

  const botConfig = bot.config;

  logger.info('------- CONFIGURATION START -------');
  logger.info(`Wallet: ${wallet.publicKey.toString()}`);

  logger.info('- Bot -');

  logger.info(
    `Using ${TRANSACTION_EXECUTOR} executer: ${bot.isWarp || bot.isJito || (TRANSACTION_EXECUTOR === 'default' ? true : false)}`,
  );
  if (bot.isWarp || bot.isJito) {
    logger.info(`${TRANSACTION_EXECUTOR} fee: ${CUSTOM_FEE}`);
  } else {
    logger.info(`Compute Unit limit: ${botConfig.unitLimit}`);
    logger.info(`Compute Unit price (micro lamports): ${botConfig.unitPrice}`);
  }

  logger.info(`Single token at the time: ${botConfig.oneTokenAtATime}`);
  logger.info(`Pre load existing markets: ${PRE_LOAD_EXISTING_MARKETS}`);
  logger.info(`Cache new markets: ${CACHE_NEW_MARKETS}`);
  logger.info(`Log level: ${LOG_LEVEL}`);
  logger.info(`Dry run: ${botConfig.dryRun}`);
  logger.info(`Raydium: ${botConfig.enableRaydium}`);
  logger.info(`pump.fun: ${botConfig.enablePumpfun}`);
  logger.info(`PumpSwap: ${botConfig.enablePumpswap}`);
  logger.info(`Close empty token accounts: ${botConfig.closeEmptyTokenAccounts}`);
  logger.info(`Retry backoff: ${botConfig.retryBackoffMs} ms`);

  logger.info('- Buy -');
  logger.info(`Buy amount: ${botConfig.quoteAmount.toFixed()} ${botConfig.quoteToken.name}`);
  logger.info(`Auto buy delay: ${botConfig.autoBuyDelay} ms`);
  logger.info(`Max buy retries: ${botConfig.maxBuyRetries}`);
  logger.info(`Buy amount (${quoteToken.symbol}): ${botConfig.quoteAmount.toFixed()}`);
  logger.info(`Buy slippage: ${botConfig.buySlippage}%`);

  logger.info('- Sell -');
  logger.info(`Auto sell: ${AUTO_SELL}`);
  logger.info(`Auto sell delay: ${botConfig.autoSellDelay} ms`);
  logger.info(`Max sell retries: ${botConfig.maxSellRetries}`);
  logger.info(`Sell slippage: ${botConfig.sellSlippage}%`);
  logger.info(`Sell slippage step: ${botConfig.sellSlippageStep}%`);
  logger.info(`Websocket price checks: ${botConfig.priceCheckWebsocket}`);
  logger.info(`Price check interval: ${botConfig.priceCheckInterval} ms`);
  logger.info(`Price check duration: ${botConfig.priceCheckDuration} ms`);
  logger.info(`Take profit: ${botConfig.takeProfit}%`);
  logger.info(`Stop loss: ${botConfig.stopLoss}%`);

  logger.info('- Snipe list -');
  logger.info(`Snipe list: ${botConfig.useSnipeList}`);
  logger.info(`Snipe list refresh interval: ${SNIPE_LIST_REFRESH_INTERVAL} ms`);

  if (botConfig.useSnipeList) {
    logger.info('- Filters -');
    logger.info(`Filters are disabled when snipe list is on`);
  } else {
    logger.info('- Filters -');
    logger.info(`Filter check interval: ${botConfig.filterCheckInterval} ms`);
    logger.info(`Filter check duration: ${botConfig.filterCheckDuration} ms`);
    logger.info(`Consecutive filter matches: ${botConfig.consecutiveMatchCount}`);
    logger.info(`Check renounced: ${botConfig.checkRenounced}`);
    logger.info(`Check freezable: ${botConfig.checkFreezable}`);
    logger.info(`Check burned: ${botConfig.checkBurned}`);
    logger.info(`Min pool size: ${botConfig.minPoolSize.toFixed()}`);
    logger.info(`Max pool size: ${botConfig.maxPoolSize.toFixed()}`);
    logger.info(`Check mutable: ${botConfig.checkMutable}`);
  }

  if (botConfig.enablePumpfun || botConfig.enablePumpswap) {
    logger.info('- pump.fun -');
    logger.info(`Curve progress: ${botConfig.pumpFilters.minCurveProgress} to ${botConfig.pumpFilters.maxCurveProgress}`);
    logger.info(`Market cap SOL: ${botConfig.pumpFilters.minMarketCapSol} to ${botConfig.pumpFilters.maxMarketCapSol}`);
    logger.info(`Dev buy SOL: ${botConfig.pumpFilters.minDevBuySol} to ${botConfig.pumpFilters.maxDevBuySol}`);
    logger.info(`Max creator hold %: ${botConfig.pumpFilters.maxCreatorHoldPercent}`);
    logger.info(`Min unique buyers: ${botConfig.pumpFilters.minUniqueBuyers}`);
    logger.info(`Max SOL already in curve: ${botConfig.pumpFilters.maxRealSol}`);
    logger.info(`Skip mayhem: ${botConfig.pumpFilters.skipMayhem}`);
    logger.info(`Allow non-SOL quote: ${botConfig.pumpFilters.allowNonSolQuote}`);
  }

  logger.info('------- CONFIGURATION END -------');

  logger.info('Bot is running! Press CTRL + C to stop it.');
}

const runListener = async () => {
  logger.level = LOG_LEVEL;
  logger.info('Bot is starting...');

  if (!ENABLE_RAYDIUM && !ENABLE_PUMPFUN && !ENABLE_PUMPSWAP) {
    logger.error('Enable at least one of ENABLE_RAYDIUM, ENABLE_PUMPFUN, ENABLE_PUMPSWAP');
    process.exit(1);
  }

  let wallet: Keypair;
  try {
    wallet = getWallet(PRIVATE_KEY.trim());
  } catch (error) {
    logger.error(error instanceof Error ? error.message : 'PRIVATE_KEY is invalid');
    process.exit(1);
  }

  const marketCache = new MarketCache(connection);
  const poolCache = new PoolCache();
  let txExecutor: TransactionExecutor;

  if (DRY_RUN) {
    txExecutor = new DryRunTransactionExecutor();
  } else {
    switch (TRANSACTION_EXECUTOR) {
      case 'warp': {
        txExecutor = new WarpTransactionExecutor(CUSTOM_FEE);
        break;
      }
      case 'jito': {
        txExecutor = new JitoTransactionExecutor(CUSTOM_FEE, connection);
        break;
      }
      default: {
        txExecutor = new DefaultTransactionExecutor(connection);
        break;
      }
    }
  }
  const quoteToken = getToken(QUOTE_MINT);
  const botConfig = <BotConfig>{
    wallet,
    quoteAta: getAssociatedTokenAddressSync(quoteToken.mint, wallet.publicKey),
    checkRenounced: CHECK_IF_MINT_IS_RENOUNCED,
    checkFreezable: CHECK_IF_FREEZABLE,
    checkBurned: CHECK_IF_BURNED,
    minPoolSize: new TokenAmount(quoteToken, MIN_POOL_SIZE, false),
    maxPoolSize: new TokenAmount(quoteToken, MAX_POOL_SIZE, false),
    quoteToken,
    quoteAmount: new TokenAmount(quoteToken, QUOTE_AMOUNT, false),
    oneTokenAtATime: ONE_TOKEN_AT_A_TIME,
    useSnipeList: USE_SNIPE_LIST,
    autoSell: AUTO_SELL,
    autoSellDelay: AUTO_SELL_DELAY,
    maxSellRetries: MAX_SELL_RETRIES,
    autoBuyDelay: AUTO_BUY_DELAY,
    maxBuyRetries: MAX_BUY_RETRIES,
    unitLimit: COMPUTE_UNIT_LIMIT,
    unitPrice: COMPUTE_UNIT_PRICE,
    takeProfit: TAKE_PROFIT,
    stopLoss: STOP_LOSS,
    buySlippage: BUY_SLIPPAGE,
    sellSlippage: SELL_SLIPPAGE,
    priceCheckInterval: PRICE_CHECK_INTERVAL,
    priceCheckDuration: PRICE_CHECK_DURATION,
    filterCheckInterval: FILTER_CHECK_INTERVAL,
    filterCheckDuration: FILTER_CHECK_DURATION,
    consecutiveMatchCount: CONSECUTIVE_FILTER_MATCHES,
    dryRun: DRY_RUN,
    closeEmptyTokenAccounts: CLOSE_EMPTY_TOKEN_ACCOUNTS,
    retryBackoffMs: RETRY_BACKOFF_MS,
    sellSlippageStep: SELL_SLIPPAGE_STEP,
    priceCheckWebsocket: PRICE_CHECK_WEBSOCKET,
    checkMutable: CHECK_IF_MUTABLE,
    enableRaydium: ENABLE_RAYDIUM,
    enablePumpfun: ENABLE_PUMPFUN,
    enablePumpswap: ENABLE_PUMPSWAP,
    pumpBuyerWaitMs: PUMP_BUYER_WAIT_MS,
    blacklist: new CreatorBlacklist(PUMP_CREATOR_BLACKLIST),
    buyers: new BuyerTracker(),
    pumpFilters: {
      minCurveProgress: PUMP_MIN_CURVE_PROGRESS,
      maxCurveProgress: PUMP_MAX_CURVE_PROGRESS,
      minMarketCapSol: PUMP_MIN_MARKET_CAP_SOL,
      maxMarketCapSol: PUMP_MAX_MARKET_CAP_SOL,
      minDevBuySol: PUMP_MIN_DEV_BUY_SOL,
      maxDevBuySol: PUMP_MAX_DEV_BUY_SOL,
      maxCreatorHoldPercent: PUMP_MAX_CREATOR_HOLD_PERCENT,
      minUniqueBuyers: PUMP_MIN_UNIQUE_BUYERS,
      maxRealSol: PUMP_MAX_REAL_SOL,
      skipMayhem: PUMP_SKIP_MAYHEM,
      allowNonSolQuote: PUMP_ALLOW_NON_SOL_QUOTE,
    },
  };

  const bot = new Bot(connection, marketCache, poolCache, txExecutor, botConfig);
  const valid = await bot.validate();

  if (!valid) {
    logger.info('Bot is exiting...');
    process.exit(1);
  }

  if (ENABLE_RAYDIUM && PRE_LOAD_EXISTING_MARKETS) {
    await marketCache.init({ quoteToken });
  }

  const runTimestamp = Math.floor(new Date().getTime() / 1000);
  const listeners = new Listeners(connection, botConfig.buyers);
  await listeners.start({
    walletPublicKey: wallet.publicKey,
    quoteToken,
    autoSell: AUTO_SELL,
    cacheNewMarkets: CACHE_NEW_MARKETS,
    enableRaydium: ENABLE_RAYDIUM,
    enablePumpfun: ENABLE_PUMPFUN,
    enablePumpswap: ENABLE_PUMPSWAP,
  });

  listeners.on('market', (updatedAccountInfo: KeyedAccountInfo) => {
    const marketState = MARKET_STATE_LAYOUT_V3.decode(updatedAccountInfo.accountInfo.data);
    marketCache.save(updatedAccountInfo.accountId.toString(), marketState);
  });

  listeners.on('pumpCreate', (event) => {
    void bot.buyPump(event).catch((error) => logger.error({ error }, 'pump.fun buy failed'));
  });

  listeners.on('pumpPool', (event) => {
    void bot.buyPumpSwap(event).catch((error) => logger.error({ error }, 'PumpSwap buy failed'));
  });

  listeners.on('pool', async (updatedAccountInfo: KeyedAccountInfo) => {
    const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(updatedAccountInfo.accountInfo.data);
    const poolOpenTime = parseInt(poolState.poolOpenTime.toString());
    const exists = await poolCache.get(poolState.baseMint.toString());

    if (!exists && poolOpenTime > runTimestamp) {
      poolCache.save(updatedAccountInfo.accountId.toString(), poolState);
      await bot.buy(updatedAccountInfo.accountId, poolState);
    }
  });

  listeners.on('wallet', async (updatedAccountInfo: KeyedAccountInfo) => {
    const data = updatedAccountInfo.accountInfo.data;
    if (data.length < AccountLayout.span) {
      return;
    }

    const accountData = AccountLayout.decode(data.subarray(0, AccountLayout.span));

    if (accountData.mint.equals(quoteToken.mint)) {
      return;
    }

    await bot.sell(updatedAccountInfo.accountId, accountData, updatedAccountInfo.accountInfo.owner);
  });

  printDetails(wallet, quoteToken, bot);
};

runListener();
