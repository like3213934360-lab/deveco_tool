import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";

/** Current developer authorization uses a form POST; query callbacks are also
 * part of the provider protocol. Neither form values nor URLs enter errors. */
export class CallbackError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
function requireCallback(
  condition: unknown,
  status: number,
  code: string,
): asserts condition {
  if (!condition) throw new CallbackError(status, code);
}
export async function readAuthCallback(
  request: IncomingMessage,
  port: number,
  nonce: string,
) {
  requireCallback(
    [`127.0.0.1:${port}`, `localhost:${port}`].includes(
      request.headers.host?.toLowerCase() ?? "",
    ),
    400,
    "CALLBACK_HOST_INVALID",
  );
  requireCallback(
    request.method === "GET" || request.method === "POST",
    405,
    "CALLBACK_METHOD_INVALID",
  );
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  requireCallback(url.pathname === "/callback", 404, "CALLBACK_PATH_INVALID");
  let params = url.searchParams;
  if (request.method === "POST") {
    requireCallback(
      request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() ===
        "application/x-www-form-urlencoded",
      415,
      "CALLBACK_CONTENT_TYPE_INVALID",
    );
    const length = request.headers["content-length"];
    requireCallback(
      length === undefined || (/^\d+$/.test(length) && Number(length) <= 65536),
      413,
      "CALLBACK_TOO_LARGE",
    );
    const chunks: Buffer[] = [];
    let bytes = 0;
    // Readable's non-destroying iterator lets the HTTP layer send a bounded error.
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      bytes += data.byteLength;
      requireCallback(bytes <= 65536, 413, "CALLBACK_TOO_LARGE");
      chunks.push(data);
    }
    const form = Buffer.concat(chunks).toString("utf8");
    requireCallback(form.length > 0, 400, "CALLBACK_FORM_EMPTY");
    params = new URLSearchParams(form);
  }
  for (const field of ["code", "tempToken", "siteId", "quit"])
    requireCallback(
      params.getAll(field).length <= 1,
      400,
      "CALLBACK_PARAMETER_AMBIGUOUS",
    );
  const code = Buffer.from(params.get("code") ?? ""),
    expected = Buffer.from(nonce);
  requireCallback(
    code.length === expected.length && crypto.timingSafeEqual(code, expected),
    400,
    "CALLBACK_NONCE_INVALID",
  );
  if (["true", "access_denied", "quit"].includes(params.get("quit") ?? ""))
    return { cancelled: true as const };
  requireCallback(
    params.get("siteId") === "1",
    400,
    "CALLBACK_REGION_UNSUPPORTED",
  );
  const token = params.get("tempToken");
  requireCallback(token, 400, "CALLBACK_TOKEN_MISSING");
  return { cancelled: false as const, token };
}
