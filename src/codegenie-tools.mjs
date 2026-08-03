/**
 * @file Static schemas for the three tools this gateway proxies to the CodeGenie child.
 * @author deveco-tool
 *
 * `tools/list` must answer from this table rather than from the child process. The child's
 * handshake intermittently stalls, and with two attempts at a 5s timeout each, a stalled child
 * made a single `tools/list` take about 14 seconds -- past the point where hosts give up on tool
 * discovery and report the server as connected but toolless. Advertising these statically means
 * discovery is always instant; the child is only contacted when one of these tools is actually
 * called, and a call that cannot reach it fails with CODEGENIE_UNAVAILABLE instead of the tool
 * silently vanishing from the list.
 *
 * These are copied verbatim from the child's own `tools/list` response. `test/unified.test.mjs`
 * asserts they still match whenever the child is reachable, so drift fails the suite rather than
 * reaching a host as a wrong schema.
 */

/** @type {ReadonlyArray<{name: string, description: string, inputSchema: object}>} */
export const PROXIED_CODEGENIE_TOOLS = Object.freeze([
  {
    name: "check_cpp_files",
    description: "对传入的 C/C++ 文件进行静态语法检查并返回 clangd 诊断信息",
    inputSchema: {
      type: "object",
      properties: {
        files: {
          description: '待检查的 C/C++ 文件路径列表，格式为 ["file1.cpp","file2.hpp",...]',
          items: { type: "string" },
          type: "array",
        },
      },
      required: ["files"],
      title: "CheckCppFilesRequest",
    },
  },
  {
    name: "perform_ui_action",
    description:
      "统一的UI操作工具，支持 click(单击)、directionalFling(方向滑动)、inputText(输入文本)、keyEvent(按键事件)、screenshot(截图)五种操作类型。",
    inputSchema: {
      type: "object",
      properties: {
        actionType: {
          description: "操作类型:click/directionalFling/inputText/keyEvent/screenshot",
          type: "string",
        },
        direction: {
          description: "(directionalFling 需要）滑动方向:0=向左,1=向右,2=向上,3=向下.默认值:0.",
          format: "int32",
          nullable: true,
          type: "integer",
        },
        displayId: {
          description: "(screenshot 可选)显示ID,用于多屏设备指定截图的屏幕,非多屏设备无需填写。",
          format: "int32",
          nullable: true,
          type: "integer",
        },
        hvd: {
          description: "目标设备的名称，只有一个设备时无需设定",
          nullable: true,
          type: "string",
        },
        key1: {
          description: "(keyEvent 需要)实体按键对应ID,取值范围:Back、Home、Power、或KeyCode键码值.",
          nullable: true,
          type: "string",
        },
        key2: {
          description: "(keyEvent 可选)第二个按键ID(组合键）.",
          nullable: true,
          type: "string",
        },
        key3: {
          description: "(keyEvent 可选)第三个按键ID(组合键）.",
          nullable: true,
          type: "string",
        },
        localPath: {
          description:
            "(screenshot 可选)本地电脑保存路径，如 D:\\screenshots\\1.png。相对路径相对于当前工作目录解析。如果不提供,截图将自动保存到当前工作目录下的 ./screenshot/ 文件夹。",
          nullable: true,
          type: "string",
        },
        savePath: {
          description:
            "(screenshot 可选)设备上的保存路径，如 /data/local/tmp/screenshot.png。如果不指定,将使用时间戳自动生成文件名。",
          nullable: true,
          type: "string",
        },
        stepLength: {
          description: "(directionalFling 可选）滑动步长，单位:px.",
          format: "int32",
          nullable: true,
          type: "integer",
        },
        text: {
          description: "(inputText 需要）输入文本内容.",
          nullable: true,
          type: "string",
        },
        velocity: {
          description: "(directionalFling 可选)滑动速度，单位:px/s,取值范围:200-40000.默认值:600.",
          format: "int32",
          nullable: true,
          type: "integer",
        },
        x: {
          description: "(click/inputText 需要）点击或输入框的 x 坐标点.",
          format: "int32",
          nullable: true,
          type: "integer",
        },
        y: {
          description: "(click/inputText 需要）点击或输入框的 y 坐标点.",
          format: "int32",
          nullable: true,
          type: "integer",
        },
      },
      required: ["actionType"],
      title: "UiActionRequest",
    },
  },
  {
    name: "get_app_ui_tree",
    description:
      "获取 UI 信息并保存为 JSON 文件。simple模式：获取窗口节点信息（WindowManagerService element dump）；full模式：获取完整UI树。",
    inputSchema: {
      type: "object",
      properties: {
        hvd: {
          description: "目标设备的名称，只有一个设备时无需设定",
          nullable: true,
          type: "string",
        },
        mode: {
          $ref: "#/$defs/UiDumpMode",
          description: "dump模式：simple-获取窗口节点信息，full-获取完整UI树",
        },
        outputDirectory: {
          description: "保存 JSON 文件的目录绝对路径",
          type: "string",
        },
      },
      required: ["mode", "outputDirectory"],
      $defs: {
        UiDumpMode: {
          oneOf: [
            {
              const: "simple",
              description: "获取窗口节点信息（WindowManagerService element dump）",
              type: "string",
            },
            {
              const: "full",
              description: "获取完整UI树",
              type: "string",
            },
          ],
        },
      },
      title: "UiDumpRequest",
    },
  },
]);

/** Names of the tools proxied to the CodeGenie child. */
export const PROXIED_CODEGENIE_TOOL_NAMES = Object.freeze(
  PROXIED_CODEGENIE_TOOLS.map((tool) => tool.name),
);
