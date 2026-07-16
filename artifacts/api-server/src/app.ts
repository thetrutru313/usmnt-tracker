import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Build the CORS origin allowlist from the environment.
// ALLOWED_ORIGINS is a comma-separated list of exact origins, e.g.
//   ALLOWED_ORIGINS=https://example.com,https://app.example.com
// In development on Replit we also accept the proxied dev domain automatically.
function buildAllowedOrigins(): string[] {
  const origins: string[] = [];

  const fromEnv = process.env.ALLOWED_ORIGINS;
  if (fromEnv) {
    origins.push(...fromEnv.split(",").map((o) => o.trim()).filter(Boolean));
  }

  // Replit dev domain — present in the workspace, absent in production deploys.
  const replitDev = process.env.REPLIT_DEV_DOMAIN;
  if (replitDev) {
    origins.push(`https://${replitDev}`);
  }

  // Replit deployment domains (space-separated list set by the deploy platform).
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) {
    for (const d of replitDomains.split(/[\s,]+/).filter(Boolean)) {
      origins.push(`https://${d}`);
    }
  }

  return origins;
}

const allowedOrigins = buildAllowedOrigins();

app.use(
  cors({
    origin(origin, callback) {
      // Allow server-to-server requests (no Origin header) and same-origin
      // requests, plus any explicitly allowlisted origin.
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin not allowed — ${origin}`));
      }
    },
    credentials: true,
  }),
);

// Global rate limiter: 300 requests per minute per IP for all public routes.
// Tighter limits can be applied per-route as needed.
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(globalLimiter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
