/** Reading Excel (.xlsx) and CSV files into rows of { column header: value }. */

export type SheetRow = Record<string, string | number | null>;

function day(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** First non-empty row is the header; fully empty rows are dropped. */
export function rowsToRecords(rows: unknown[][]): SheetRow[] {
  const isEmpty = (row: unknown[]) => row.every((cell) => cell === null || cell === undefined || String(cell).trim() === "");
  const start = rows.findIndex((row) => !isEmpty(row));
  if (start === -1) return [];
  const headers = rows[start].map((cell, index) => String(cell ?? "").trim() || `Column ${index + 1}`);
  return rows
    .slice(start + 1)
    .filter((row) => !isEmpty(row))
    .map((row) =>
      Object.fromEntries(
        headers.map((header, index) => {
          const cell = row[index];
          if (cell instanceof Date) return [header, day(cell)];
          if (typeof cell === "number") return [header, cell];
          if (cell === null || cell === undefined) return [header, null];
          return [header, String(cell).trim()];
        })
      )
    );
}

/** CSV text (comma or semicolon separated, quotes allowed) into rows of cells. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const firstLine = source.slice(0, source.indexOf("\n") === -1 ? undefined : source.indexOf("\n"));
  // Excel in many European locales saves CSV with semicolons.
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Reads the first sheet of an .xlsx file, or a .csv file. */
export async function readSpreadsheet(file: File): Promise<SheetRow[]> {
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") return rowsToRecords(parseCsv(await file.text()));
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Choose an Excel workbook (.xlsx) or a CSV file. Old .xls files: open in Excel and Save As .xlsx.");
  // Loaded only when someone imports, to keep the app quick to open.
  const { readSheet } = await import("read-excel-file/browser");
  return rowsToRecords((await readSheet(file)) as unknown[][]);
}

/** A CSV file to download (opens in Excel). */
export function downloadCsv(fileName: string, rows: (string | number)[][]) {
  const cell = (value: string | number) => (/[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value));
  const url = URL.createObjectURL(new Blob([`﻿${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
