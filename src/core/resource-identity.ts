/** Native emulator endpoints may be presented with any of these loopback aliases.
 * Canonicalize only resource identity; retain the selected HDC address for commands. */
export function resourceIdentity(resource: string): string {
  const match = /^device:(?:127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})$/i.exec(resource);
  const port = match ? Number(match[1]) : 0;
  return port > 0 && port <= 65535 ? `device:127.0.0.1:${port}` : resource;
}
