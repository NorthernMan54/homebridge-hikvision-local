export class Log {
  private logger: any;
  private debugMode: boolean;

  constructor(logger: any, debugMode: boolean) {
    this.logger = logger;
    this.debugMode = debugMode;
  }

  private stringifyArgs(args: unknown[]): string {
    return args
      .map(arg => {
        if (typeof arg === 'string') return arg;
        if (Buffer.isBuffer(arg)) return arg.toString('utf8');
        if (typeof arg === 'object') return JSON.stringify(arg, null, 2);
        return String(arg);
      })
      .join(' ');
  }

  debug(...args: unknown[]) {
    const message = this.stringifyArgs(args);
    if (this.debugMode) {
      this.logger.info(message);
    } else {
      this.logger.debug(message);
    }
  }

  info(...args: unknown[]) {
    this.logger.info(this.stringifyArgs(args));
  }

  warn(...args: unknown[]) {
    this.logger.warn(this.stringifyArgs(args));
  }

  error(...args: unknown[]) {
    this.logger.error(this.stringifyArgs(args));
  }

  log(...args: unknown[]) {
    this.logger.info(this.stringifyArgs(args));
  }
}
