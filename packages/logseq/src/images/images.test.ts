/** Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assetLinks, relinked } from "./images.ts";

test("an embedded image, its size attribute part of the link", () => {
  const text = "see ![shot](../assets/image_1.png){:height 1079, :width 778} here";
  const [link] = assetLinks(text);
  assert.equal(link.embed, true);
  assert.equal(link.alt, "shot");
  assert.equal(link.asset, "assets/image_1.png");
  assert.equal(text.slice(link.start, link.end), "![shot](../assets/image_1.png){:height 1079, :width 778}");
});

test("a file link, a link from assets/ directly, and an escaped name", () => {
  const links = assetLinks("[doc](../assets/a.pdf) ![](assets/b.png) ![](../assets/my%20pic.png)");
  assert.deepEqual(
    links.map((l) => [l.embed, l.asset]),
    [[false, "assets/a.pdf"], [true, "assets/b.png"], [true, "assets/my pic.png"]],
  );
});

test("a target that would leave assets/ names no asset", () => {
  const [link] = assetLinks("![](../assets/../../secret.png)");
  assert.equal(link.asset, undefined);
});

test("links elsewhere are not asset links", () => {
  assert.deepEqual(assetLinks("![](https://x.com/a.png) [a](b.md) ![](images/x.png)"), []);
});

test("swapped links are rewritten, the others left as written", () => {
  const text = "![a](../assets/a.png){:width 10} and ![b](../assets/b.gif)";
  const [a] = assetLinks(text);
  assert.equal(relinked(text, new Map([[a, "![a](images/abc.png)"]])), "![a](images/abc.png) and ![b](../assets/b.gif)");
});

test("an asset name with spaces in it, as Logseq writes one", () => {
  const [link] = assetLinks("![shot.png](../assets/Screenshot_2025-09-13_at_5.12.41 PM_1757808791994_0.png)");
  assert.equal(link.asset, "assets/Screenshot_2025-09-13_at_5.12.41 PM_1757808791994_0.png");
});
