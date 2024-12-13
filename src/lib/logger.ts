export class Log {
  private logger: any;
  private debugMode: boolean;

  constructor(logger: any, debugMode: boolean) {
    this.logger = logger;
    this.debugMode = debugMode;
  }

  debug(msg:string) {
    if (this.debugMode) {
      this.logger.info(msg);
    } else {
      this.logger.debug(msg);
    }
  }

  info(msg:string) {
    this.logger.info(msg);
  }

  warn(msg:string) {
    this.logger.warn(msg);
  }

  error(msg:string) {
    this.logger.error(msg);
  }

  log(msg:string) {
    this.logger.info(msg);
  }
}
