import { StringDecoder } from "node:string_decoder";

// Reserved slots prevent a flood of warnings from hiding later errors or SDK risks.
const EXAMPLE_LIMITS = { compilerError: 3, sdkCompatibility: 3, deprecatedApi: 2, dependencyBundling: 1, sourceMaps: 1 };

// Streaming and bounded: diagnostics near the beginning survive a truncated output tail.
export function createBuildDiagnostics() {
  const streams = new Map();
  const counts = {};
  const examples = Object.fromEntries(Object.keys(EXAMPLE_LIMITS).map(category => [category, []]));
  function line(stream, raw) {
    const text = raw.replace(/\x1b\[[0-9;]*m/g, "").trim();
    if (/ArkTS:(?:WARN|ERROR).*File:/.test(text)) {
      stream.location = text.slice(-1000);
      stream.compilerError = /ArkTS:ERROR/.test(text);
      return;
    }
    if (!text) return;
    let location = /ArkTS:(?:WARN|ERROR)/.test(text) ? null : stream.location;
    const compilerError = stream.compilerError;
    stream.compilerError = false;
    stream.location = null;
    const arktsLocation = /\bAt File:\s*(.+?:\d+(?::\d+)?)/.exec(text);
    const nativeLocation = /^(.+?:\d+(?::\d+)?):\s*(?:fatal )?error:/i.exec(text);
    if (arktsLocation || nativeLocation) location = (arktsLocation || nativeLocation)[1];
    const category = compilerError || /^Error Message:|\bArkTS:ERROR\b|^error\s+TS\d+:|^SyntaxError:/i.test(text) || nativeLocation ? "compilerError"
      : /compatible SDK version|provided since API|requires API/i.test(text) ? "sdkCompatibility"
      : /deprecated/i.test(text) ? "deprecatedApi"
      : /commonjs--resolver|commonjs.*duplicate|duplicate.*commonjs/i.test(text) ? "dependencyBundling"
      : /sourceMaps.*(?:not found|missing)|(?:not found|missing).*sourceMaps/i.test(text) ? "sourceMaps"
      : null;
    if (!category) return;
    counts[category] = (counts[category] ?? 0) + 1;
    const sample = { category, location: location || null, message: text.slice(0, 1000) };
    const bucket = examples[category];
    if (bucket.length < EXAMPLE_LIMITS[category]
      && !bucket.some(item => item.location === sample.location && item.message === sample.message)) bucket.push(sample);
  }
  return {
    push(name, chunk) {
      let stream = streams.get(name);
      if (!stream) streams.set(name, stream = { decoder: new StringDecoder("utf8"), pending: "", location: null });
      stream.pending += stream.decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      let end;
      while ((end = stream.pending.indexOf("\n")) >= 0) {
        line(stream, stream.pending.slice(0, end));
        stream.pending = stream.pending.slice(end + 1);
      }
      // Pathological generated single lines must not accumulate indefinitely.
      if (stream.pending.length > 16384) {
        line(stream, stream.pending.slice(0, 16384));
        stream.pending = stream.pending.slice(-4096);
      }
    },
    finish() {
      for (const stream of streams.values()) {
        line(stream, stream.pending + stream.decoder.end());
        stream.pending = "";
      }
      streams.clear();
      return { counts: { ...counts }, examples: Object.values(examples).flat(),
        exampleLimits: { ...EXAMPLE_LIMITS },
        scope: "Recognized diagnostic lines, not unique issues. Examples are bounded per category and ordered by priority. Consult the captured CLI log for emitted details." };
    },
  };
}

export function formatBuildDiagnostics(diagnostics) {
  if (!diagnostics || !Object.keys(diagnostics.counts).length) return "";
  return `[Diagnostic Summary] ${JSON.stringify(diagnostics)}\nApplication SDK/deprecation warnings and dependency bundling warnings are separate from MCP transport failures.\n\n`;
}
