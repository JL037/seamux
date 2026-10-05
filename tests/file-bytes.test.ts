import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { fileDownloadUrl, fileRawUrl } from "~/lib/files";
import { loader as download } from "~/routes/file-download";
import { loader as raw } from "~/routes/file-raw";

describe("file bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "seamux-raw-"));
  const path = join(dir, "notes é.txt");
  writeFileSync(path, "hello");

  const get = (loader: typeof raw | typeof download, url: string) =>
    loader({
      request: new Request(`http://localhost${url}`, {
        headers: { host: "localhost" },
      }),
    } as never) as Promise<Response>;

  it("serves the bytes inline", async () => {
    const response = await get(raw, fileRawUrl(path));
    expect(await response.text()).toBe("hello");
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBe(
      "sandbox allow-scripts allow-popups allow-downloads",
    );
  });

  it("asks the browser to save it from /file/download", async () => {
    const response = await get(download, fileDownloadUrl(path));
    expect(await response.text()).toBe("hello");
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''notes%20%C3%A9.txt",
    );
  });
});
