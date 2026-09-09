/** Locations are evidence from the selected event, never paths to open automatically. */
export function rankCrashFrames(frames: string[], bundle: string | null) {
  return frames
    .flatMap((raw, stack_index) => {
      let body = raw.trim().replace(/^#\d+\s+at\s+/, "at ");
      if (body.startsWith("at ")) {
        body = body.slice(3).trim();
        const opening = body.indexOf("(");
        if (opening >= 0 && body.endsWith(")"))
          body = body.slice(opening + 1, -1);
      } else {
        const separator = body.indexOf("@");
        if (separator > 0) body = body.slice(separator + 1);
      }
      let frame_bundle: string | null = null,
        module: string | null = null,
        version: string | null = null;
      const packaged =
        /^([^|\s]{1,256})\|([^|\s]{1,256})\|([^|\s]{1,128})\|([^|]+)$/.exec(
          body,
        );
      if (packaged) {
        frame_bundle = packaged[1]!;
        module = packaged[2]!;
        version = packaged[3]!;
        body = packaged[4]!;
      }
      const location = /^(.+\.(?:ets|ts|js)):(\d+)(?::(\d+))?$/i.exec(body);
      if (!location || /[\x00-\x1f\x7f]/.test(body)) return [];
      const file = location[1]!,
        line = Number(location[2]),
        column = location[3] === undefined ? null : Number(location[3]);
      if (
        ![line, ...(column === null ? [] : [column])].every(
          (value) =>
            Number.isSafeInteger(value) && value > 0 && value <= 2147483647,
        )
      )
        return [];
      const normalized = file.replaceAll("\\", "/").toLowerCase();
      const reasons: string[] = [];
      let score = 0;
      const dependency =
        /(?:^|\/)(?:node_modules|oh_modules)(?:\/|$)/.test(normalized) ||
        /^(?:\/?(?:framework|runtime|ets_runtime|foundation|system|sdk)\/|@(?:ohos|hms)\.)/.test(
          normalized,
        );
      if (dependency) {
        score -= 100;
        reasons.push("framework_or_dependency_path");
      }
      if (/(?:^|\/)entry\/.*\.ets$/.test(normalized)) {
        score += 8;
        reasons.push("entry_arkts_path");
      }
      if (/(?:^|\/)src\//.test(normalized)) {
        score += 6;
        reasons.push("source_directory");
      }
      if (
        /(?:^|\/)(?:pages?|feature|components?|viewmodel|store|model)\//.test(
          normalized,
        )
      ) {
        score += 3;
        reasons.push("application_directory");
      }
      if (
        bundle &&
        (frame_bundle === bundle || normalized.includes(bundle.toLowerCase()))
      ) {
        score += 4;
        reasons.push("bundle_name_in_path");
      }
      const classification = dependency
        ? "dependency"
        : score > 0
          ? "application_candidate"
          : "unclassified";
      return [
        {
          raw,
          stack_index,
          file,
          line,
          column,
          frame_bundle,
          module,
          version,
          score,
          classification,
          reasons,
          file_verified: false,
        },
      ];
    })
    .sort((a, b) => b.score - a.score || a.stack_index - b.stack_index);
}
