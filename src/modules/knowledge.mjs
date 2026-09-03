/**
 * @file 调用华为 CodeGenie bigSearch 知识检索 + 结果抽取
 * @author dreamlike
 */

import { BIG_SEARCH_URL, MAX_RESULT_LENGTH, NETWORK_TIMEOUT_MS, RESULT_MARKER } from "./config.mjs";
import { ensureAccessToken } from "./auth.mjs";

/**
 * 调用知识检索端点
 * @param {string} question 自然语言问题
 * @param {string} token accessToken
 * @returns {Promise<object>} 原始响应 JSON
 */
async function callBigSearch(question, token) {
  let response;
  try {
    response = await fetch(BIG_SEARCH_URL, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    });
  } catch (error) {
    const wrapped = new Error(`Knowledge request failed: ${error.name === "TimeoutError" ? `network timeout after ${NETWORK_TIMEOUT_MS}ms` : error.message}`);
    wrapped.code = error.name === "TimeoutError" ? "DEVECO_NETWORK_TIMEOUT" : "DEVECO_NETWORK_FAILED";
    throw wrapped;
  }
  if (!response.ok) {
    const error = new Error(`Knowledge service failed: HTTP ${response.status}`);
    error.code = "DEVECO_KNOWLEDGE_HTTP_ERROR";
    throw error;
  }
  return await response.json();
}

/**
 * 是否为鉴权失败响应(token 失效)
 * @param {object} data 响应 JSON
 * @returns {boolean}
 */
function isAuthError(data) {
  return Boolean(data) && typeof data.error_code === "number" && data.error_code === 4016;
}

/**
 * 从成功响应抽取检索片段(取 RESULT_MARKER 之后并截断)
 * @param {object} data 响应 JSON
 * @returns {string|null} 文本; 非成功响应返回 null
 */
function extractResult(data) {
  if (data && data.code === 200) {
    const prompt = data.body && data.body.answer && data.body.answer.prompt;
    if (prompt) {
      const index = prompt.indexOf(RESULT_MARKER);
      const result = index !== -1 ? prompt.slice(index + RESULT_MARKER.length) : prompt;
      return result.slice(0, MAX_RESULT_LENGTH);
    }
    return "No answer found for question.";
  }
  return null;
}

/**
 * 检索官方 ArkTS/HarmonyOS 知识库
 * @param {string} question 自然语言问题
 * @returns {Promise<string>} 检索结果文本
 */
export async function searchKnowledge(question) {
  let token = await ensureAccessToken({ interactive: false });
  let data = await callBigSearch(question, token);

  // token 失效 -> 强制刷新后重试一次
  if (isAuthError(data)) {
    token = await ensureAccessToken({ force: true, interactive: false });
    data = await callBigSearch(question, token);
  }

  const result = extractResult(data);
  if (result !== null) {
    return result;
  }
  if (data && data.error_msg) {
    throw new Error(`Knowledge service error: ${data.error_msg}`);
  }
  throw new Error(`Unexpected response from knowledge service: ${JSON.stringify(data).slice(0, 300)}`);
}
