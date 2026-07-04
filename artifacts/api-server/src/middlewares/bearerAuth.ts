import type { NextFunction, Request, Response } from "express";

/**
 * Minimal shared-secret bearer token check, shared by both the /mcp
 * transport and the protected /api/tasks* REST routes.
 *
 * This is deliberately simple (not OAuth, not per-user accounts): every
 * caller (human or agent) currently shares a single trusted secret. The goal
 * is only "not wide open to anyone who finds the URL," not enterprise auth.
 * Revisit this if these endpoints ever need to support more than one caller
 * with distinct identities/permissions.
 */
export function bearerAuth(req: Request, res: Response, next: NextFunction): void {
  const expectedToken = process.env["MCP_ACCESS_TOKEN"];
  if (!expectedToken) {
    req.log.error("MCP_ACCESS_TOKEN is not configured; rejecting request");
    res.status(401).json({ error: "Server is not configured" });
    return;
  }

  const authHeader = req.header("authorization");
  const providedToken = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;

  if (!providedToken || providedToken !== expectedToken) {
    req.log.warn({ path: req.path }, "Rejected request: missing or incorrect bearer token");
    res.status(401).json({ error: "Missing or invalid bearer token" });
    return;
  }

  next();
}
