---
name: Express sub-router path doubling
description: A mounted Express router's internal route paths must be relative to the mount point, not repeat it.
---

When mounting a router with `app.use("/mcp", mcpRouter)`, routes defined inside `mcpRouter` must use `router.post("/", ...)`, not `router.post("/mcp", ...)`. Using the mount segment again inside the sub-router produces an effective path of `/mcp/mcp`, and requests to the intended `/mcp` 404 with Express's default "Cannot POST" handler.

**Why:** Hit this while wiring up a new `/mcp` route in `@workspace/api-server` — typechecked fine, server started fine, but every request 404'd. Root cause was invisible from types/logs; only curling both the proxy and the raw port revealed the double-mount.

**How to apply:** Whenever adding a new mounted sub-router in an Express app, define its internal routes at `"/"` (or a *different* sub-path) relative to the app.use() prefix, never repeating the prefix segment.
