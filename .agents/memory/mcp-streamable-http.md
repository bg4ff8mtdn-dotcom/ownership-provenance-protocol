---
name: MCP Streamable HTTP setup in this repo
description: How /mcp is wired in @workspace/api-server — stateless transport, auth placement, shared logic with REST.
---

`@workspace/api-server` exposes an MCP endpoint at `/mcp` alongside the REST API at `/api`, both behind the shared proxy (registered in that artifact's `artifact.toml` `paths`).

Key decisions worth staying consistent with:

- **Stateless transport.** Each `/mcp` POST creates a fresh `McpServer` + `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` pair, torn down on `res.close`. No session store. GET/DELETE (which only make sense in stateful mode) are explicitly rejected with 405 rather than silently mishandled.
- **Shared service layer, not duplicated logic.** MCP tools and REST routes both call into the same `services/*Service.ts` functions and validate with the same generated Zod schemas (`@workspace/api-zod`). The route/tool layer is a thin translation only — this is intentional so the two surfaces can't drift.
- **Minimal auth by design.** `/mcp` uses a single shared-secret bearer token (an env var, e.g. `MCP_ACCESS_TOKEN`) checked by a small middleware placed before the route handler — not OAuth, not per-user identity. Chosen because the current consumers are trusted single-tenant agents, not end users.

**Why:** These choices were made deliberately (not just "whatever worked") when first adding MCP to this API server — keeping the pattern consistent avoids re-deriving the same tradeoffs (stateful vs stateless, shared vs duplicated logic, auth complexity) on the next MCP endpoint in this repo.

**How to apply:** When adding new MCP tools or a second MCP-exposing route in this codebase, follow the same stateless-transport + shared-service-layer + minimal-shared-secret-auth pattern unless the user explicitly asks for session state or multi-user auth.
