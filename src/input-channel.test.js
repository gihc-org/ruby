import { describe, expect, it } from "vitest";
import { SharedInputChannel } from "./input-channel.js";

describe("SharedInputChannel", () => {
  it("writes lines in order and exposes the available byte count", () => {
    const channel = new SharedInputChannel(64);

    channel.write("Ada\n");
    channel.write("42\n");

    expect(Atomics.load(channel.control, 0)).toBe(7);
    expect(new TextDecoder().decode(channel.bytes.slice(0, 7))).toBe("Ada\n42\n");
  });

  it("resets input between runs", () => {
    const channel = new SharedInputChannel(64);
    channel.write("first\n");
    channel.reset();
    channel.write("second\n");

    expect(Atomics.load(channel.control, 0)).toBe(7);
    expect(new TextDecoder().decode(channel.bytes.slice(0, 7))).toBe("second\n");
  });

  it("rejects input that does not fit in the buffer", () => {
    const channel = new SharedInputChannel(4);

    expect(() => channel.write("oversize")).toThrow("Inputbufferen er fuld.");
  });
});
