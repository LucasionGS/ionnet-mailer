import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { HTTPException } from "hono/http-exception";
import type { ApiError } from "@ionnet/shared";
import type { AppEnv } from "./http/types.ts";
import { attachClientIp } from "./http/middleware.ts";
import { HttpError } from "./errors.ts";
import { config } from "./config.ts";
import { logger } from "./logger.ts";
import { authRoutes } from "./auth/routes.ts";
import { accountRoutes } from "./account/routes.ts";
import { setupRoutes } from "./setup/routes.ts";
import { adminRoutes } from "./admin/routes.ts";
import { mailRoutes } from "./mail/routes.ts";
import { contactRoutes } from "./contacts/routes.ts";
import { wellknownRoutes } from "./wellknown/routes.ts";

const log = logger("http");

export function createApp() {
  const app = new Hono<AppEnv>();
  app.use("*", attachClientIp);

  app.get("/healthz", (c) => c.text("ok"));
  app.route("/", wellknownRoutes);

  const api = new Hono<AppEnv>();
  api.route("/setup", setupRoutes);
  api.route("/auth", authRoutes);
  api.route("/account", accountRoutes);
  api.route("/admin", adminRoutes);
  api.route("/mail", mailRoutes);
  api.route("/contacts", contactRoutes);
  api.notFound((c) => c.json({ error: "not_found", message: `No route for ${c.req.method} ${c.req.path}` } satisfies ApiError, 404));
  app.route("/api", api);

  if (!config.isDev) {
    app.use("/*", serveStatic({ root: "./public" }));
    app.get("*", async (c) => {
      const path = c.req.path;
      // JSON 404 for unknown API routes; plain 404 for missing build assets.
      if (path.startsWith("/api/")) {
        return c.json({ error: "not_found", message: `No route for ${c.req.method} ${path}` } satisfies ApiError, 404);
      }
      if (path.startsWith("/assets/") || /\.[a-z0-9]{2,5}$/i.test(path)) return c.notFound();
      // Everything else is a client-side route: serve the SPA shell.
      const res = await serveStatic({ root: "./public", path: "index.html" })(c, async () => undefined);
      return res ?? c.notFound();
    });
  }

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      const body: ApiError = { error: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) };
      return c.json(body, err.status as 400);
    }
    if (err instanceof HTTPException) {
      return c.json({ error: "http_error", message: err.message } satisfies ApiError, err.status);
    }
    log.error(`${c.req.method} ${c.req.path} failed`, err);
    return c.json({ error: "internal_error", message: config.isDev ? err.message : "Something went wrong" } satisfies ApiError, 500);
  });
  return app;
}
