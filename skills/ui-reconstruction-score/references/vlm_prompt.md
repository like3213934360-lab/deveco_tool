# 视觉模型提示词

当请求视觉模型协助结构化 UI 比较时使用此提示词。将占位符替换为实际的图片路径或附件。

```text
你正在对比两张 UI 截图：
- 参考/设计截图：<reference>
- 候选/实现截图：<candidate>

忽略顶部设备状态信息区域，包括时间、信号、运营商、Wi-Fi 和电池。不要将其报告为差异。

以参考截图为真实来源。对照参考分析候选截图。

在选择问题之前，将两张截图划分为语义 UI 区域，并分别比较每个区域。考虑可能的设备分辨率或全局缩放差异。如果候选图整体一致地偏大/偏小，但保持了锚点、层级、可读性和区域关系，则不将其报告为问题。

仅返回 JSON：
{
  "page_type": "full_screen_app|list_or_grid|media_immersive|bottom_sheet_or_dialog|empty_error_skeleton|other",
  "comparability": 0.0,
  "global_scale_assessment": {
    "has_uniform_scale_difference": false,
    "estimated_candidate_scale_vs_reference": 1.0,
    "scale_affects_usability_or_layout": false,
    "notes": "string"
  },
  "regions": [
    {
      "id": "string",
      "type": "status_ignored|header|tabs|search|content_flow|list|grid|media|overlay|dialog|bottom_sheet|bottom_nav|empty_state|other",
      "reference_box": [x, y, w, h],
      "candidate_box": [x, y, w, h],
      "anchor": "top|bottom|center|content_flow|none",
      "importance": "low|medium|high",
      "assessment": "match|acceptable_scale_delta|minor_delta|issue"
    }
  ],
  "dynamic_regions": [
    {
      "reason": "string",
      "reference_box": [x, y, w, h],
      "candidate_box": [x, y, w, h]
    }
  ],
  "candidate_issues": [
    {
      "area": "UI 区域名称",
      "problem": "候选实现中可操作的问题",
      "likely_code_area": "需要检查的可能组件/样式/约束",
      "severity": "low|medium|high|critical"
    }
  ]
}

问题选择规则：
- 包含零个、一个或两个 candidate_issues。当没有明确可操作的问题时返回空数组。
- 优先选择可见且可在代码中定位的锚点、遮罩/层级、区域偏移、裁切/换行、媒体适配和透明度/颜色问题。
- 不要报告微小或不可操作的差异。不要为了凑够两个而添加第二个问题。
- 不要报告全局一致的缩放/分辨率差异，除非它导致裁切、重叠、项目数量错误、锚点破坏或可读性问题。
- 不要仅说两个东西不一样。描述实现问题和可能原因。
- 不要包含手机状态栏/时间/电池/信号差异。
```
