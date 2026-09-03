import type { IncomingMessage, ServerResponse } from "node:http";

import { createAppRequestHandler } from "../src/server/server.ts";

const handleRequest = createAppRequestHandler({ isProduction: true });

export default function vercelHandler(request: IncomingMessage, response: ServerResponse) {
  return handleRequest(request, response);
}
