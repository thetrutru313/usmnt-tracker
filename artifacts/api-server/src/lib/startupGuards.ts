import { logger } from "./logger";

/**
 * Run a startup task whose failure shouldn't stop the server: the error is
 * logged and startup carries on. (A failed league-strength seed — one dropped
 * database connection — crash-looped a publish on 6 Nov 2026.)
 */
export async function runNonFatal<T>(name: string, task: () => Promise<T>): Promise<T | undefined> {
  try {
    return await task();
  } catch (err) {
    logger.error({ err, task: name }, "Startup task failed — server continues without it");
    return undefined;
  }
}

function logUnhandledRejection(reason: unknown): void {
  logger.error({ err: reason }, "Unhandled promise rejection — logged, server kept running");
}

/**
 * Log promise rejections that nothing handled, instead of letting Node stop
 * the whole process (its default). The syncs run on timers in the
 * background; one of them failing shouldn't take the API down with it.
 * Safe to call more than once; returns the handler.
 */
export function installUnhandledRejectionLogger(): (reason: unknown) => void {
  if (!process.listeners("unhandledRejection").includes(logUnhandledRejection)) {
    process.on("unhandledRejection", logUnhandledRejection);
  }
  return logUnhandledRejection;
}
