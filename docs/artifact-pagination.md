# 制品分页与调用循环保护

`workflow_run { action: "read_artifact", as: "page" }` 返回 base64 内容、总字节数 `bytes`、数值游标 `next_offset` 和布尔结束标记 `eof`。游标按原始字节计数，与 base64 字符数不同；最后一页的 `next_offset` 等于 `bytes`，不会变成 `null`。

- 正常读取在 `eof === true` 或 `next_offset >= bytes` 时结束。
- 非空制品读到末尾后再次请求（或越过末尾）返回 `ARTIFACT_EOF`，`ok:false`、`retryable:false`。收到错误即停止当前循环。
- 空制品允许读取一次空的首页，返回 `bytes:0`、`next_offset:0`、`eof:true`。
- 同一 MCP 连接对同一制品、同一字节偏移的快速重复请求最多放行 8 次；后续返回 `ARTIFACT_READ_LOOP`，不应自动重试。该偏移连续 10 秒没有被请求后恢复。更换 `limit` 不会重置保护。
- 被保护拦截的请求异步等待 250 毫秒后返回，支持取消；忽略错误的串行循环也会被降速。最多保留 128 个最近偏移的计数，不缓存制品内容。正常推进偏移、其他制品、其他工具和图片读取不共享该计数；这不是全局速率限制。

读取循环还应设置总页数、总字节数和时间上限，并在游标不前进时停止。以下是 Node MCP SDK 客户端示例（`client` 为已连接客户端）：

```js
async function readArtifact(client, artifactId) {
  const parts = [], maxBytes = 8 * 1024 * 1024;
  const signal = AbortSignal.timeout(30_000);
  let offset = 0;
  for (let page = 0; page < 128; page++) {
    const response = await client.callTool({
      name: "workflow_run",
      arguments: { action: "read_artifact", artifact_id: artifactId,
        as: "page", offset, limit: 65536 },
    }, undefined, { signal });
    const result = response.structuredContent;
    if (response.isError || !result?.ok) throw new Error(JSON.stringify(result));
    const part = result.data;
    if (!Number.isSafeInteger(part.bytes) || part.bytes < 0 || part.bytes > maxBytes)
      throw new Error("Artifact exceeds the byte budget");
    const chunk = Buffer.from(part.data, "base64");
    if (part.offset !== offset || part.next_offset !== offset + chunk.length ||
        part.next_offset > part.bytes) throw new Error("Invalid artifact cursor");
    parts.push(chunk);
    if (part.eof || part.next_offset >= part.bytes) {
      if (part.next_offset !== part.bytes) throw new Error("Incomplete artifact");
      return Buffer.concat(parts);
    }
    if (part.next_offset <= offset) throw new Error("Artifact cursor did not advance");
    offset = part.next_offset;
  }
  throw new Error("Artifact page budget exceeded");
}
```

仅需查看 PNG/JPEG 时，直接使用 `as: "image"`，由 MCP 返回图片内容，无需分页拼接。

回归测试 `test/native-artifact-pagination.test.ts` 使用隔离状态目录和真实 stdio MCP 连接，以 158547 字节制品重现错误的 `while (offset !== null)` 条件，并独立限制最多 16 次调用。修复后该错误循环在第 4 次调用停止；正常读取只需 3 页。测试同时覆盖空制品、整页边界、越界、图片响应、重复读取降速和取消，不对真实 Codex 界面制造调用洪流。
