import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from './logger';

/**
 * Resolve when `check` returns true, or when `durationMs` elapses.
 * Account notifications wake the check immediately. `intervalMs` is the
 * heartbeat used when the socket is quiet.
 */
export async function watchAccountUntil(
  connection: Connection,
  account: PublicKey | undefined,
  intervalMs: number,
  durationMs: number,
  useWebsocket: boolean,
  check: () => Promise<boolean>,
): Promise<void> {
  if (durationMs <= 0 || intervalMs <= 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    let done = false;
    let subscription: number | undefined;

    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      clearInterval(timer);
      clearTimeout(timeout);
      if (subscription !== undefined) {
        connection.removeAccountChangeListener(subscription).catch(() => undefined);
      }
      resolve();
    };

    const tick = () => {
      if (done) {
        return;
      }
      check()
        .then((shouldExit) => {
          if (shouldExit) {
            finish();
          }
        })
        .catch((error) => {
          logger.trace({ error }, 'Price check failed');
        });
    };

    if (useWebsocket && account) {
      try {
        subscription = connection.onAccountChange(account, () => tick(), connection.commitment);
      } catch (error) {
        logger.debug({ error }, 'Account subscription failed; price checks will poll');
      }
    }

    const timer = setInterval(tick, intervalMs);
    const timeout = setTimeout(finish, durationMs);
    tick();
  });
}
