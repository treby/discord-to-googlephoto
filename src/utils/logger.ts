type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const minLevel: Level = (process.env.LOG_LEVEL as Level) || "info";

function log(level: Level, message: string, context?: Record<string, unknown>) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  const entry = {
    time: new Date().toISOString(),
    level,
    message,
    ...context,
  };
  const line = JSON.stringify(entry, (_key, value) =>
    value instanceof Error
      ? { name: value.name, message: value.message, stack: value.stack }
      : value,
  );
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) =>
    log("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) =>
    log("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) =>
    log("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) =>
    log("error", message, context),
};
