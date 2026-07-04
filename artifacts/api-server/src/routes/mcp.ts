import { Router, type IRouter } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createTaskMcpServer } from "../mcp/tools";
import { bearerAuth } from "../middlewares/bearerAuth";

const router: IRouter = Router();

// Stateless mode: every request gets a fresh server + transport pair, torn
// down when the response closes. This is a thin translation layer with no
// server-side session state to maintain, so statelessness keeps this simple
// and avoids leaking connections across requests.
router.post("/", bearerAuth, async (req, res): Promise<void> => {
  const server = createTaskMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// Streamable HTTP also defines GET (server-initiated SSE stream) and DELETE
// (session termination) methods for the stateful mode. In stateless mode
// there is no long-lived session to stream from or terminate, so those
// methods are not meaningful here — reject them explicitly rather than
// silently accepting requests the transport can't fulfill.
router.get("/", bearerAuth, (_req, res): void => {
  res.status(405).json({ error: "Method not allowed in stateless MCP mode" });
});

router.delete("/", bearerAuth, (_req, res): void => {
  res.status(405).json({ error: "Method not allowed in stateless MCP mode" });
});

export default router;
