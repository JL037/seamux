import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { fileRawUrl } from "~/lib/files";
import { loader } from "~/routes/file-raw";

describe("file raw", () => {
  const dir = mkdtempSync(join(tmpdir(), "seamux-raw-"));
  const path = join(dir, "notes é.txt");
  writeFileSync(path, "hello");

  const get = (query = "") =>
    loader({
      request: new Request(`http://localhost${fileRawUrl(path)}${query}`, {
        headers: { host: "localhost" },
      }),
    } as never) as Promise<Response>;

  it("serves the bytes inline", async () => {
    const response = await get();
    expect(await response.text()).toBe("hello");
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBe(
      "sandbox allow-scripts allow-popups allow-downloads",
    );
  });

  it("asks the browser to save it with ?dl=1", async () => {
    const response = await get("?dl=1");
    expect(await response.text()).toBe("hello");
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''notes%20%C3%A9.txt",
    );
  });
});
