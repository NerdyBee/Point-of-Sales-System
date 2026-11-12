import { describe, expect, it } from "vitest";
import { parseCsv, rowsToRecords } from "./spreadsheet";

describe("spreadsheet reading", () => {
  it("parses CSV with quotes, commas inside quotes, a BOM and Windows line ends", () => {
    expect(parseCsv('﻿Name,Price\r\n"Rice, 50kg",45000\r\n"Say ""hi""",1\r\n')).toEqual([
      ["Name", "Price"],
      ["Rice, 50kg", "45000"],
      ['Say "hi"', "1"]
    ]);
  });

  it("reads semicolon CSV from European Excel", () => {
    expect(parseCsv("Name;Price\nRice;45000")).toEqual([["Name", "Price"], ["Rice", "45000"]]);
  });

  it("turns rows into records under the first non-empty row's headers", () => {
    const records = rowsToRecords([[null, null], ["Name", "Price", "Since"], ["Rice", 45000, new Date(2026, 9, 5)], ["", null, ""], ["Beans", " 900 ", null]]);
    expect(records).toEqual([
      { Name: "Rice", Price: 45000, Since: "2026-10-05" },
      { Name: "Beans", Price: "900", Since: null }
    ]);
  });
});
