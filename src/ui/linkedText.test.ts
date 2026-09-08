/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest";
import { renderLinkedText } from "./linkedText";

let host: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  host = document.createElement("h1");
  document.body.append(host);
});

const anchors = () => [...host.querySelectorAll("a")];

describe("painting a task's text", () => {
  it("leaves text with no link in it alone", () => {
    renderLinkedText(host, "Pay the taxes");
    expect(host.textContent).toBe("Pay the taxes");
    expect(anchors()).toHaveLength(0);
  });

  it("draws a URL short, and keeps the real one on the anchor", () => {
    renderLinkedText(host, "Read https://www.anthropic.com/news/a-very-long-article-slug-here later");

    const [link] = anchors();
    expect(link).toBeDefined();
    expect(link!.textContent).not.toContain("https://");
    expect(link!.getAttribute("href")).toBe(
      "https://www.anthropic.com/news/a-very-long-article-slug-here",
    );
    expect(link!.title).toBe("https://www.anthropic.com/news/a-very-long-article-slug-here");
  });

  it("keeps the words either side of the link", () => {
    renderLinkedText(host, "Read https://example.com/x later");
    expect(host.textContent).toBe("Read example.com/x later");
  });

  it("opens in a new tab without handing over the opener", () => {
    renderLinkedText(host, "https://example.com/x");
    const [link] = anchors();
    expect(link!.target).toBe("_blank");
    expect(link!.rel).toBe("noopener noreferrer");
  });

  it("handles several links on one line", () => {
    renderLinkedText(host, "https://one.example.com and https://two.example.com");
    expect(anchors()).toHaveLength(2);
    expect(host.textContent).toContain(" and ");
  });

  it("does not rebuild when the text has not changed", () => {
    // The panel repaints four times a second; a fresh anchor under the pointer
    // would be impossible to click.
    renderLinkedText(host, "Read https://example.com/x later");
    const first = anchors()[0];
    renderLinkedText(host, "Read https://example.com/x later");
    expect(anchors()[0]).toBe(first);
  });

  it("does rebuild when the task is renamed", () => {
    renderLinkedText(host, "Read https://example.com/x later");
    renderLinkedText(host, "Read https://example.com/y later");
    expect(anchors()[0]!.getAttribute("href")).toBe("https://example.com/y");
  });
});
