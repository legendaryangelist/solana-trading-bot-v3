import pino from 'pino'; 

const transport = pino.transport({
  target: 'pino-pretty',
});

export const logger = pino(
  {
    level: 'info',
    redact: ['poolKeys', 'privateKey', 'secretKey', 'mnemonic', 'seed', 'PRIVATE_KEY'],
    serializers: {
      error: pino.stdSerializers.err,
    },
    base: undefined,
  },
  transport,
);
