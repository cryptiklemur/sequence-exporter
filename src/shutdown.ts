import type { FastifyInstance } from "fastify";
import type { SequenceCollector } from "./scrape/collector.js";

type Exit = (code: number) => void;

export interface ShutdownDeps {
  app: Pick<FastifyInstance, "close" | "log">;
  collector: Pick<SequenceCollector, "stop">;
  exit?: Exit;
}

export function createShutdown(deps: ShutdownDeps): (signal: string) => Promise<void> {
  const { app, collector } = deps;
  const exit: Exit = deps.exit ?? ((code) => process.exit(code));
  return async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutting down");
    try {
      await collector.stop();
      await app.close();
      exit(0);
    } catch (err) {
      app.log.error({ err }, "shutdown failed");
      exit(1);
    }
  };
}
