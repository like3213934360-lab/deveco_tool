import { StringDecoder } from "node:string_decoder";

const limits = {
  compilerError: 3,
  sdkCompatibility: 3,
  deprecatedApi: 2,
  dependencyBundling: 1,
  sourceMaps: 1,
};
type Category = keyof typeof limits;
export interface Example {
  category: Category;
  location: string | null;
  message: string;
}
interface Stream {
  decoder: StringDecoder;
  pending: string;
  location: string | null;
  compilerError: boolean;
}

/** Retain early errors even when the process output tail is truncated. */
export class BuildDiagnostics {
  private readonly streams = new Map<string, Stream>();
  private readonly counts: Partial<Record<Category, number>> = {};
  private readonly examples = new Map<Category, Example[]>();
  private line(stream: Stream, raw: string) {
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
    const arkts = /\bAt File:\s*(.+?:\d+(?::\d+)?)/.exec(text);
    const native = /^(.+?:\d+(?::\d+)?):\s*(?:fatal )?error:/i.exec(text);
    if (arkts || native) location = (arkts ?? native)?.[1] ?? null;
    const category: Category | undefined =
      compilerError ||
      /^Error Message:|\bArkTS:ERROR\b|^error\s+TS\d+:|^SyntaxError:/i.test(
        text,
      ) ||
      native
        ? "compilerError"
        : /compatible SDK version|provided since API|requires API/i.test(text)
          ? "sdkCompatibility"
          : /deprecated/i.test(text)
            ? "deprecatedApi"
            : /commonjs--resolver|commonjs.*duplicate|duplicate.*commonjs/i.test(
                  text,
                )
              ? "dependencyBundling"
              : /sourceMaps.*(?:not found|missing)|(?:not found|missing).*sourceMaps/i.test(
                    text,
                  )
                ? "sourceMaps"
                : undefined;
    if (!category) return;
    this.counts[category] = (this.counts[category] ?? 0) + 1;
    const sample = { category, location, message: text.slice(0, 1000) };
    const bucket = this.examples.get(category) ?? [];
    if (
      bucket.length < limits[category] &&
      !bucket.some(
        (item) => item.location === location && item.message === sample.message,
      )
    )
      bucket.push(sample);
    this.examples.set(category, bucket);
  }
  push(name: string, chunk: Buffer) {
    let stream = this.streams.get(name);
    if (!stream) {
      stream = {
        decoder: new StringDecoder("utf8"),
        pending: "",
        location: null,
        compilerError: false,
      };
      this.streams.set(name, stream);
    }
    stream.pending += stream.decoder.write(chunk);
    let end: number;
    while ((end = stream.pending.indexOf("\n")) >= 0) {
      this.line(stream, stream.pending.slice(0, end));
      stream.pending = stream.pending.slice(end + 1);
    }
    if (stream.pending.length > 16384) {
      this.line(stream, stream.pending.slice(0, 16384));
      stream.pending = stream.pending.slice(-4096);
    }
  }
  finish() {
    for (const stream of this.streams.values())
      this.line(stream, stream.pending + stream.decoder.end());
    this.streams.clear();
    return {
      counts: { ...this.counts },
      examples: (Object.keys(limits) as Category[]).flatMap(
        (key) => this.examples.get(key) ?? [],
      ),
      exampleLimits: limits,
      scope:
        "Recognized diagnostic lines, not unique issues. Read the process log artifact for full evidence.",
    };
  }
}
