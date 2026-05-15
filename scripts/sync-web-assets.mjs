import { cp, rm } from "node:fs/promises";

await rm(new URL("../apps/api/public", import.meta.url), { force: true, recursive: true });
await cp(new URL("../apps/web/dist", import.meta.url), new URL("../apps/api/public", import.meta.url), {
  recursive: true
});
