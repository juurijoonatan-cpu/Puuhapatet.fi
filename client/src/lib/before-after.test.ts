import { describe, it, expect } from "vitest";
import { clampPercent, positionFromPointer, stepPosition, easeToward, MIN_POS, MAX_POS } from "./before-after";

describe("clampPercent", () => {
  it("keeps the handle grabbable at both ends", () => {
    expect(clampPercent(-40)).toBe(MIN_POS);
    expect(clampPercent(140)).toBe(MAX_POS);
    expect(clampPercent(50)).toBe(50);
  });

  it("falls back to the midpoint instead of leaking NaN into a style", () => {
    expect(clampPercent(NaN)).toBe(50);
    expect(clampPercent(Infinity)).toBe(50);
  });
});

describe("positionFromPointer", () => {
  it("maps a pointer inside the track to a percentage", () => {
    expect(positionFromPointer(300, { left: 100, width: 400 })).toBe(50);
    expect(positionFromPointer(200, { left: 100, width: 400 })).toBe(25);
  });

  it("clamps a pointer dragged outside the track", () => {
    expect(positionFromPointer(0, { left: 100, width: 400 })).toBe(MIN_POS);
    expect(positionFromPointer(9999, { left: 100, width: 400 })).toBe(MAX_POS);
  });

  it("survives a zero-width box on the first frame after mount", () => {
    expect(positionFromPointer(300, { left: 0, width: 0 })).toBe(50);
  });
});

describe("stepPosition", () => {
  it("nudges with arrows and jumps with page keys", () => {
    expect(stepPosition(50, "ArrowRight")).toBe(52);
    expect(stepPosition(50, "ArrowLeft")).toBe(48);
    expect(stepPosition(50, "ArrowRight", true)).toBe(60);
    expect(stepPosition(50, "PageUp")).toBe(60);
    expect(stepPosition(50, "PageDown")).toBe(40);
  });

  it("slams to the ends and ignores unrelated keys", () => {
    expect(stepPosition(50, "Home")).toBe(MIN_POS);
    expect(stepPosition(50, "End")).toBe(MAX_POS);
    expect(stepPosition(50, "a")).toBeNull();
    expect(stepPosition(50, "Tab")).toBeNull();
  });

  it("stays inside the track when stepping off the edge", () => {
    expect(stepPosition(MIN_POS, "ArrowLeft")).toBe(MIN_POS);
    expect(stepPosition(MAX_POS, "ArrowRight")).toBe(MAX_POS);
  });
});

describe("easeToward", () => {
  it("moves the same distance per millisecond regardless of frame rate", () => {
    // 120 Hz (two 8.33 ms frames) must land where 60 Hz (one 16.67 ms frame) does.
    const oneBigFrame = easeToward(0, 100, 16.6667);
    let twoSmallFrames = easeToward(0, 100, 8.3333);
    twoSmallFrames = easeToward(twoSmallFrames, 100, 8.3333);
    expect(Math.abs(oneBigFrame - twoSmallFrames)).toBeLessThan(0.01);
  });

  it("snaps to the target so the animation loop can stop", () => {
    expect(easeToward(99.99, 100, 16.6667)).toBe(100);
    expect(easeToward(50, 50, 16.6667)).toBe(50);
  });

  it("never overshoots the target", () => {
    const next = easeToward(10, 90, 500);
    expect(next).toBeLessThanOrEqual(90);
    expect(next).toBeGreaterThan(10);
  });
});
