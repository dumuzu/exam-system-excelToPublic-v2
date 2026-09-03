const forbiddenFetchPorts = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161,
  179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563,
  587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 4336,
  6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080,
]);

function listen(server: Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

export async function withFetchableServer(server: Server, run: (origin: string) => Promise<void> | void): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await listen(server);
    const address = server.address();
    if (address && typeof address !== "string" && !forbiddenFetchPorts.has((address as AddressInfo).port)) {
      try {
        await run(`http://127.0.0.1:${(address as AddressInfo).port}`);
      } finally {
        await close(server);
      }
      return;
    }
    await close(server);
  }

  throw new Error("Unable to allocate a fetchable local test port.");
}
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
