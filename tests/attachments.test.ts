// How a draft takes files in (app/lib/attachments.ts), shared by a chat's
// full view and the dispatch box.

import { describe, expect, it } from "vitest";

import { nameFrom } from "~/lib/drive.server";
import {
  fitAttachments,
  insertLabels,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  withoutLabels,
} from "~/lib/attachments";

const file = (name: string, size = 1) =>
  new File([new Uint8Array(size)], name, { type: "image/png" });

describe("fitAttachments", () => {
  it("takes what fits, and says why the rest didn't", () => {
    const big = file("big.png", MAX_ATTACHMENT_BYTES + 1);
    expect(fitAttachments([file("a.png"), big], 0)).toEqual({
      fit: [expect.objectContaining({ name: "a.png" })],
      error: `Over ${MAX_ATTACHMENT_BYTES >> 20} MB: big.png`,
    });
    const { fit, error } = fitAttachments(
      [file("a.png"), file("b.png")],
      MAX_ATTACHMENTS - 1,
    );
    expect(fit.map((f) => f.name)).toEqual(["a.png"]);
    expect(error).toBe(`At most ${MAX_ATTACHMENTS} attachments`);
  });
});

describe("insertLabels", () => {
  it("puts labels in place of the selection, spaced from the words", () => {
    expect(insertLabels("look at this", 8, 8, ["[Image #1]"])).toEqual({
      text: "look at [Image #1] this",
      caret: 19,
    });
    expect(insertLabels("fix it", 6, 6, ["[Image #1]", "[File #2]"])).toEqual({
      text: "fix it [Image #1] [File #2] ",
      caret: 28,
    });
  });
});

describe("withoutLabels", () => {
  it("leaves a dispatch's name to its words", () => {
    expect(nameFrom(withoutLabels("[Image #1] Fix the login page"))).toBe(
      "fix-the-login-page",
    );
  });
});
