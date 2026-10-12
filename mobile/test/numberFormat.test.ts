import { describe, expect, it } from "vitest";
import { groupDigits } from "../src/ui/numberFormat";

describe("number entry formatting", () => {
  it("groups thousands while typing and keeps blanks blank", () => {
    expect(groupDigits("30000")).toBe("30,000");
    expect(groupDigits("1234567")).toBe("1,234,567");
    expect(groupDigits("999")).toBe("999");
    expect(groupDigits("")).toBe("");
    expect(groupDigits("0")).toBe("0");
  });

  it("cleans pasted or edited text", () => {
    expect(groupDigits("30,0000")).toBe("300,000");
    expect(groupDigits("N 12,500")).toBe("12,500");
    expect(groupDigits("007")).toBe("7");
  });
});
