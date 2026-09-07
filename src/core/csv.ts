import { invariant } from "./errors.js";

/** RFC 4180 fields, including embedded newlines, escaped quotes and UTF-8 BOM. */
export function parseCsv(input: string): string[][] {
  invariant(
    Buffer.byteLength(input) <= 16 * 1024 * 1024,
    "CSV_TOO_LARGE",
    "CSV report exceeds 16 MiB",
  );
  const source = input.replace(/^\uFEFF/, ""),
    rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  const column = () => {
    row.push(field);
    field = "";
    closed = false;
  };
  const line = () => {
    column();
    if (row.some((value) => value.length > 0)) rows.push(row);
    row = [];
    invariant(
      rows.length <= 100000,
      "CSV_TOO_LARGE",
      "CSV report exceeds 100000 rows",
    );
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
      continue;
    }
    if (c === ",") {
      column();
      continue;
    }
    if (c === "\r" || c === "\n") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      line();
      continue;
    }
    invariant(
      !closed,
      "CSV_INVALID",
      "Unexpected characters after a quoted CSV field",
    );
    if (c === '"') {
      invariant(
        field.length === 0,
        "CSV_INVALID",
        "Quote in unquoted CSV field",
      );
      quoted = true;
    } else field += c;
  }
  invariant(!quoted, "CSV_INVALID", "CSV ends inside a quoted field");
  if (field.length || row.length || closed) line();
  return rows;
}
export function apiReport(csv: string) {
  const [headers, ...rows] = parseCsv(csv);
  invariant(
    headers && new Set(headers).size === headers.length,
    "API_REPORT_INVALID",
    "Missing or duplicate API report headers",
  );
  for (const name of [
    "Api Definition",
    "Language",
    "Changed in SDK",
    "Affected Versions",
    "Title",
    "Code Location",
    "Change Type",
  ])
    invariant(
      headers.includes(name),
      "API_REPORT_INVALID",
      `API report is missing ${name}`,
    );
  return rows.map((row) => {
    invariant(
      row.length === headers.length,
      "API_REPORT_INVALID",
      "API report row does not match its headers",
    );
    const record = Object.fromEntries(
      headers.map((header, index) => [header, row[index]!]),
    );
    const link = /^=HYPERLINK\("((?:[^"]|"")*)","((?:[^"]|"")*)"\)$/.exec(
      record.Title ?? "",
    );
    return {
      api: record["Api Definition"]!,
      language: record.Language!,
      change_id: record.ChangeId ?? null,
      changed_in: record["Changed in SDK"]!,
      affected_versions: record["Affected Versions"]!,
      title: link ? link[2]!.replaceAll('""', '"') : record.Title!,
      source_url:
        link && /^https:\/\//.test(link[1]!)
          ? link[1]!.replaceAll('""', '"')
          : null,
      location: record["Code Location"]!,
      change_type: record["Change Type"]!,
    };
  });
}
