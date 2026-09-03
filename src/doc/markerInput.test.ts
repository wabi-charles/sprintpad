import { describe, expect, it } from "vitest";
import { markerInputAction, type SwallowedMarker } from "./markerInput";

const emptyLine = { from: 10, to: 10, text: "" };
const indentedEmpty = { from: 10, to: 12, text: "  " };
const writtenLine = { from: 10, to: 19, text: "Pay taxes" };

const run = (consumed: string, pos = 10): SwallowedMarker => ({ pos, consumed });

describe("markerInputAction", () => {
  it("absorbs the first bracket at the head of an empty task", () => {
    expect(markerInputAction(emptyLine, 10, "[", null)).toEqual({ kind: "swallow", consumed: "[" });
  });

  it("absorbs the rest of the old marker as it is typed", () => {
    expect(markerInputAction(emptyLine, 10, "]", run("["))).toEqual({
      kind: "swallow",
      consumed: "[]",
    });
    expect(markerInputAction(emptyLine, 10, " ", run("[]"))).toEqual({
      kind: "swallow",
      consumed: "[] ",
    });
  });

  it("absorbs the spaced form too", () => {
    expect(markerInputAction(emptyLine, 10, " ", run("["))).toEqual({
      kind: "swallow",
      consumed: "[ ",
    });
    expect(markerInputAction(emptyLine, 10, "]", run("[ "))).toEqual({
      kind: "swallow",
      consumed: "[ ]",
    });
  });

  it("types a real bracket on the second press", () => {
    expect(markerInputAction(emptyLine, 10, "[", run("["))).toEqual({ kind: "literal" });
  });

  it("works at the head of an indented empty task", () => {
    expect(markerInputAction(indentedEmpty, 12, "[", null)).toEqual({
      kind: "swallow",
      consumed: "[",
    });
  });

  it("leaves a line that already has text alone", () => {
    expect(markerInputAction(writtenLine, 19, "[", null)).toBeNull();
  });

  it("leaves a bracket typed mid-line alone", () => {
    expect(markerInputAction(indentedEmpty, 11, "[", null)).toBeNull();
  });

  it("does not absorb characters that never formed the old marker", () => {
    expect(markerInputAction(emptyLine, 10, "]", null)).toBeNull();
    expect(markerInputAction(emptyLine, 10, " ", null)).toBeNull();
    expect(markerInputAction(emptyLine, 10, "x", null)).toBeNull();
    expect(markerInputAction(emptyLine, 10, "x", run("["))).toBeNull();
  });

  it("ignores a run recorded at a different position", () => {
    expect(markerInputAction(emptyLine, 10, "[", run("[", 4))).toEqual({
      kind: "swallow",
      consumed: "[",
    });
  });
});
