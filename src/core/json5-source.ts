import JSON5 from "json5";

/** Source spans in a validated JSON5 document, indexed by JSON path. */
export function json5Locations(text: string) {
  JSON5.parse(text);
  const locations = new Map<string, { start: number; end: number; line: number }>();
  const tokens: { text: string; start: number; end: number; line: number }[] = [];
  let end = 0, line = 1;
  for (const match of text.matchAll(/\/\/[^\r\n\u2028\u2029]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[{}\[\]:,]|[^\s{}\[\]:,"'/]+/g)) {
    line += text.slice(end, match.index).split(/\r\n|[\r\n\u2028\u2029]/).length - 1;
    const token = match[0];
    if (!token.startsWith("//") && !token.startsWith("/*")) tokens.push({ text: token, start: match.index, end: match.index + token.length, line });
    line += token.split(/\r\n|[\r\n\u2028\u2029]/).length - 1;
    end = match.index + token.length;
  }
  let cursor = 0;
  const visit = (at: (string | number)[], propertyLine?: number) => {
    const first = tokens[cursor++]!;
    let last = first;
    if (first.text === "{" || first.text === "[") {
      const close = first.text === "{" ? "}" : "]";
      let index = 0;
      while (tokens[cursor]!.text !== close) {
        let key: string | number = index++;
        let keyLine: number | undefined;
        if (first.text === "{") {
          const property = tokens[cursor++]!;
          key = Object.keys(JSON5.parse("{" + property.text + ":0}"))[0]!;
          keyLine = property.line;
          cursor++; // colon
        }
        visit([...at, key], keyLine);
        if (tokens[cursor]?.text === ",") cursor++;
      }
      last = tokens[cursor++]!;
    }
    locations.set(JSON.stringify(at), { start: first.start, end: last.end, line: propertyLine ?? first.line });
  };
  visit([]);
  return locations;
}
