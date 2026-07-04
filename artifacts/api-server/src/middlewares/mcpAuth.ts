import type { NextFunction, Request, Response } from "express";

/**
 * Minimal shared-secret bearer token check for the /mcp route.
 *
 * This is deliberately simple (not OAuth, not per-user accounts): the MCP
 * server currently has a single trusted caller, not a multi-user audience.
 * The goal is only "not wide open to anyone who finds the URL," not
 * enterprise auth. Revisit this if /mcp ever needs to support more than one
 * caller with distinct identities/permissions.
 */
export function mcpAuth(req: Request, res: Response, next: NextFunction): void {
  const expectedToken = process.env["MCP_ACCESS_TOKEN"];
  if (!expectedToken) {
    req.log.error("MCP_ACCESS_TOKEN is not configured; rejecting all /mcp requests");
    res.status(401).json({ error: "MCP server is not configured" });
    return;
  }

  const authHeader = req.header("authorization");
  const providedToken = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;

  if (!providedToken || providedToken !== expectedToken) {
    req.log.warn("Rejected /mcp request: missing or incorrect bearer token");
    res.status(401).json({ error: "Missing or invalid bearer token" });
    return;
  }

  next();
}
