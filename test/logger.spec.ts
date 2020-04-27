import Logger, { LogLevel } from "../src/logger";

describe("Logger", () => {
  let oldLoggerPrint: (logLevel: LogLevel, ..._: unknown[]) => void;
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    oldLoggerPrint = (Logger as any)._print;
  });

  it("should be disabled by default", function () {
    expect(Logger.logLevel).toBe(LogLevel.Disabled);
  });

  it("should be accept new log level", function () {
    const checkedLevels: LogLevel[] = [];

    Logger.setLogFunction((logLevel) => {
      checkedLevels.push(logLevel);
    });

    Logger.logLevel = LogLevel.Warnings;

    expect(Logger.logLevel).toBe(LogLevel.Warnings);

    Logger.log("");
    Logger.warn("");
    Logger.error("");

    expect(checkedLevels).toStrictEqual([LogLevel.Warnings, LogLevel.Errors]);
  });

  it("should accept new log function", function () {
    Logger.logLevel = LogLevel.All;

    const checkedLevels: LogLevel[] = [];
    const testMessage = "test it";

    Logger.setLogFunction((logLevel, ...args) => {
      checkedLevels.push(logLevel);

      expect(args[0]).toBe(testMessage);
    });

    Logger.log(testMessage);
    Logger.warn(testMessage);
    Logger.error(testMessage);

    expect(checkedLevels).toStrictEqual([
      LogLevel.All,
      LogLevel.Warnings,
      LogLevel.Errors,
    ]);
  });

  afterAll(() => {
    Logger.setLogFunction(oldLoggerPrint);
  });
});
