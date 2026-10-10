// Optional OpenCode plugin: observe provider bytes without changing the request or Response.
// Bodies include private model context. Never publish these files or capture auth headers.
import fs from "node:fs";
import path from "node:path";

export const Capture = async () => {
  const directory = process.env.DEVECO_MODEL_CAPTURE;
  if (!directory) throw new Error("DEVECO_MODEL_CAPTURE required");
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async function(input, init) {
    const body = typeof init?.body === "string" ? init.body : undefined;
    let file;
    if (body?.includes('"model"') && body.includes('"tools"')) {
      const request = JSON.parse(body);
      if (request.tools?.some((tool) => (tool.function?.name ?? tool.name) === "deveco_ui")) {
        file = path.join(directory, `provider-${++count}`);
        fs.writeFileSync(file + ".request.json", body, { mode: 0o600 });
      }
    }
    const response = await original.call(this, input, init);
    if (file) response.clone().text().then(
      (text) => fs.writeFileSync(file + ".response.txt", text, { mode: 0o600 }),
      (error) => fs.writeFileSync(file + ".error.txt", String(error), { mode: 0o600 }),
    );
    return response;
  };
  return {};
};
