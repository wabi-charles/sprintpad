import { describe, expect, it } from "vitest";
import { findLinks, hrefFor, shortenUrl } from "./links";

const labels = (text: string) => findLinks(text).map((link) => link.label);
const hrefs = (text: string) => findLinks(text).map((link) => link.href);

describe("findLinks", () => {
  it("finds nothing in ordinary text", () => {
    expect(findLinks("Pay taxes before the deadline")).toEqual([]);
  });

  it("reports the span the URL occupies", () => {
    expect(findLinks("read https://example.com today")).toEqual([
      {
        from: 5,
        to: "read https://example.com".length,
        href: "https://example.com",
        label: "example.com",
      },
    ]);
  });

  it("finds several links on one line", () => {
    expect(hrefs("https://a.com and https://b.com")).toEqual(["https://a.com", "https://b.com"]);
  });

  it("promotes a bare www. host to https, keeping the host intact", () => {
    expect(hrefs("www.example.com")).toEqual(["https://www.example.com"]);
    expect(labels("www.example.com")).toEqual(["example.com"]);
  });

  it("leaves the word www alone", () => {
    expect(findLinks("the www is old")).toEqual([]);
  });

  it("ignores schemes a browser should not be handed", () => {
    expect(findLinks("javascript:alert(1)")).toEqual([]);
    expect(findLinks("mailto:a@b.com")).toEqual([]);
  });

  it("does not swallow the sentence's punctuation", () => {
    expect(hrefs("see https://example.com/x.")).toEqual(["https://example.com/x"]);
    expect(hrefs("see https://example.com/x, then")).toEqual(["https://example.com/x"]);
  });

  it("gives back a closing bracket it did not open", () => {
    expect(hrefs("(see https://example.com/x)")).toEqual(["https://example.com/x"]);
  });

  it("keeps a closing bracket that belongs to the URL", () => {
    expect(hrefs("https://en.wikipedia.org/wiki/Mercury_(planet)")).toEqual([
      "https://en.wikipedia.org/wiki/Mercury_(planet)",
    ]);
  });
});

describe("shortenUrl", () => {
  it("drops the scheme and the www", () => {
    expect(shortenUrl("https://www.example.com")).toBe("example.com");
  });

  it("shows a short path in full", () => {
    expect(shortenUrl("https://github.com/anthropics")).toBe("github.com/anthropics");
  });

  it("drops a trailing slash", () => {
    expect(shortenUrl("https://example.com/docs/")).toBe("example.com/docs");
  });

  it("truncates a long path but never the host", () => {
    const label = shortenUrl("https://www.notion.so/workspace/A-very-long-page-title-9f2c41ab");
    expect(label.startsWith("notion.so/")).toBe(true);
    expect(label.endsWith("…")).toBe(true);
    expect(label.length).toBeLessThanOrEqual(35);
  });

  it("keeps the whole host even when the host alone is long", () => {
    const host = "some-extremely-long-subdomain.example.co.uk";
    expect(shortenUrl(`https://${host}/a/b/c/d/e/f`)).toBe(`${host}…`);
  });

  it("keeps the query string when it fits", () => {
    expect(shortenUrl("https://example.com/s?q=1")).toBe("example.com/s?q=1");
  });

  it("hands back anything it cannot parse", () => {
    expect(shortenUrl("http://")).toBe("http://");
  });
});

describe("hrefFor", () => {
  it("leaves an absolute URL alone", () => {
    expect(hrefFor("http://example.com")).toBe("http://example.com");
  });
});
