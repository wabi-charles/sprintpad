import { describe, expect, it } from "vitest";
import { park, parkEdit } from "./park";

const DOC = ["# TODAY", "Ship it", "", "# BACKLOG", "Something that can wait"].join("\n");

describe("parking a thought", () => {
  it("files it at the bottom", () => {
    expect(park(DOC, "renew the domain").split("\n")).toEqual([
      "# TODAY",
      "Ship it",
      "",
      "# BACKLOG",
      "Something that can wait",
      "renew the domain",
    ]);
  });

  it("touches nothing before it, so the cursor cannot move", () => {
    // The whole feature rests on this: the edit begins past everything else.
    const edit = parkEdit(DOC, "renew the domain")!;
    expect(edit.from).toBe(DOC.length);
    expect(DOC.slice(0, edit.from)).toBe(DOC);
  });

  it("lands tight under the last line, not after the blank ones", () => {
    const trailing = `${DOC}\n\n\n`;
    expect(park(trailing, "renew the domain").split("\n")).toEqual([
      "# TODAY",
      "Ship it",
      "",
      "# BACKLOG",
      "Something that can wait",
      "renew the domain",
    ]);
  });

  it("keeps a thought that arrived with newlines in it to one line", () => {
    expect(park("Ship it", "call the bank\nabout the mortgage")).toBe(
      "Ship it\ncall the bank about the mortgage",
    );
  });

  it("trims the hurry off both ends", () => {
    expect(park("Ship it", "   renew the domain   ")).toBe("Ship it\nrenew the domain");
  });

  it("declines to file nothing", () => {
    expect(parkEdit(DOC, "")).toBeNull();
    expect(parkEdit(DOC, "    ")).toBeNull();
    expect(parkEdit(DOC, "\n\n")).toBeNull();
    expect(park(DOC, "  ")).toBe(DOC);
  });

  it("starts a document that has nothing in it yet", () => {
    expect(park("", "renew the domain")).toBe("renew the domain");
    expect(park("\n\n", "renew the domain")).toBe("renew the domain");
  });

  it("files a plain line, which is what an open task is", () => {
    // No marker: the grammar's whole point is that a bare line is a task.
    expect(park(DOC, "renew the domain").endsWith("\nrenew the domain")).toBe(true);
  });
});
