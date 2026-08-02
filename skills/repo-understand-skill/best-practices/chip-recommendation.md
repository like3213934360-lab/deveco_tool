# 筛选标签模式

> Chip 推荐体系：activated 双态 + ImmersiveMaterial(REGULAR→THICK) + fadingEdge + interactionIcon 渐变按钮

---

## 关键实现方法

### 1. Chip activated 双态 + ImmersiveMaterial

**源码**: `CategoryFilter.ets`

```typescript
Chip({
  prefixSymbol: card.icon ? {
    normal: new SymbolGlyphModifier($r(card.icon))
      .fontColor([$r('sys.color.icon_secondary')]),
    activated: new SymbolGlyphModifier($r(card.icon))
      .fontColor([$r('sys.color.icon_on_primary')]),
  } : undefined,
  label: { text: ..., fontSize: ..., fontColor: ... },
  size: ChipSize.SMALL,
  activated: card.id.toString() === this.currentSelectCard,
  backgroundColor: Color.Transparent,
  activatedBackgroundColor: Color.Transparent,
  backgroundSystemMaterial: new uiMaterial.ImmersiveMaterial({
    style: uiMaterial.ImmersiveStyle.REGULAR,  // 非激活态
    colorInvert: true,
    applyShadow: false
  }),
  activatedBackgroundSystemMaterial: new uiMaterial.ImmersiveMaterial({
    style: uiMaterial.ImmersiveStyle.THICK,    // 激活态材质升级
    colorInvert: true,
    applyShadow: false,
    materialColor: '#4D4D4D'
  }),
  onClicked: () => { this.currentSelectCard = card.id.toString(); }
})
```

**要点**: 非激活态用 REGULAR 材质，激活态升级到 THICK 并自定义 materialColor，实现视觉层次跃迁。

---

### 2. Chip prefixIcon/prefixSymbol + suffixSymbol(xmark)

**源码**: `SmartSearchBar.ets`

```typescript
// 人物标签 — prefixIcon + suffixSymbol(xmark)
Chip({
  prefixIcon: {
    src: this.smartLabelChips[index].image ?? $r('sys.symbol.person'),
    size: { width: PREFIXICONSIZE, height: PREFIXICONSIZE },
    fillColor: Color.Red,
  },
  label: { text: '', labelMargin: { left: MARGIN_TWO, right: MARGIN_TWO } },
  suffixSymbol: {
    normal: new SymbolGlyphModifier($r('sys.symbol.xmark'))
      .fontColor(this.getSymbolGlyphColor())
      .onClick(() => { this.smartLabelChipClose(...) })
  },
  suffixSymbolOptions: {
    action: () => { this.smartLabelChipClose(...) }
  },
  size: { height: CHIP_HEIGHT },
  backgroundColor: this.currentMode == ConfigurationConstant.ColorMode.COLOR_MODE_DARK
    ? undefined : this.getSmartlabelBackgroundColor()
})

// 推荐Chip — prefixSymbol + activated双态 + ImmersiveMaterial
Chip({
  prefixSymbol: (ENTITY_TO_ICON_RESOURCE_MAP.has(entity) &&
    this.isSystemResource(ENTITY_TO_ICON_RESOURCE_MAP.get(entity))) ? {
    normal: new SymbolGlyphModifier($r(...)).fontColor([this.chipsListColor]),
  } : undefined,
  prefixIcon: (!this.isSystemResource(...)) ? {
    src: $r(...), size: { width: ..., height: ... },
    fillColor: $r('sys.color.icon_primary')
  } : undefined,
  label: { text: ..., fontColor: this.chipsListColor },
  activated: item.isSelectedChip,
  backgroundSystemMaterial: new uiMaterial.ImmersiveMaterial({
    style: uiMaterial.ImmersiveStyle.THICK, applyShadow: true
  }),
  activatedBackgroundSystemMaterial: new uiMaterial.ImmersiveMaterial({
    materialColor: $r('sys.color.ohos_id_color_emphasize'),
    style: uiMaterial.ImmersiveStyle.THICK, applyShadow: true
  }),
})
```

**要点**: prefixSymbol 用于系统 SymbolGlyph 图标，prefixIcon 用于自定义图片图标；suffixSymbol 用 xmark 实现可关闭标签。

---

### 3. interactionIcon 渐变按钮

**源码**: `ChipListView.ets` + `Constants.ets`

```typescript
// 展开态 — SymbolGlyph + shaderStyle LinearGradient
SymbolGlyph($r('sys.symbol.ai_search'))
  .shaderStyle(new LinearGradientStyle({
    angle: 135,
    colors: [
      ['rgba(0, 132, 255, 1.0)', 0.0],   // 蓝
      ['rgba(146, 102, 251, 1.0)', 0.5],  // 紫
      ['rgba(229, 72, 219, 1.0)', 1.0]    // 粉
    ]
  }))

// 容器 — systemMaterial + 圆形裁切
Column() { ... }
  .borderRadius(this.viewParamConfig.chipBorderRadius)  // 50% 圆形
  .systemMaterial(this.isSupportMaterial ? this.materialType : undefined)
  .backgroundColor(this.isSupportMaterial ? Color.Transparent : ...)
  .backgroundBlurStyle(this.isSupportMaterial ? BlurStyle.NONE : BlurStyle.COMPONENT_ULTRA_THIN)
```

**要点**: SymbolGlyph 的 shaderStyle 属性支持 LinearGradientStyle 渐变填充；展开态显示渐变，收起态显示纯色，通过 isAllowShow() 状态切换。

---

### 4. fadingEdge 渐隐效果

**源码**: `ChipListView.ets` (自定义蒙层实现)

```typescript
@Builder
createOverlayBuilder() {
  Row() {
    Row().width(this.fadingLength).height('100%')
      .linearGradient({
        direction: GradientDirection.Right,
        colors: [[OverlayColors.TRANSPARENT, 0], [OverlayColors.OPAQUE, 1]]
      })
    Row().height('100%').layoutWeight(1).backgroundColor(OverlayColors.OPAQUE)
    Row().width(this.fadingLength).height('100%')
      .linearGradient({
        direction: GradientDirection.Right,
        colors: [[OverlayColors.OPAQUE, 0], [OverlayColors.TRANSPARENT, 1]]
      })
  }
  .width('100%').height('100%')
  .blendMode(BlendMode.DST_IN, BlendApplyType.OFFSCREEN)
  .hitTestBehavior(HitTestMode.BLOCK_DESCENDANTS)
}
```

**要点**: 三段式渐隐（左侧渐入 + 中间满色 + 右侧渐出），通过 blendMode DST_IN 蒙层混合实现裁切效果；RTL 场景自动反转方向。

---

### 5. ChipGroup 分段切换

**源码**: `PickerRecommendTabBar.ets`

```typescript
ChipGroup({
  items: this.getShowItems(),  // ChipGroupItemOptions[]
  itemStyle: { size: ChipSize.SMALL, backgroundColor: ..., selectedBackgroundColor: ... },
  selectedIndexes: this.chipGroupIndexList,
  multiple: false,
  onChange: (activatedChipsIndex: number[]) => { this.changeTab(activatedChipsIndex[0]); },
})
```

**要点**: ChipGroup 封装了多选/单选逻辑，multiple:false 为单选模式，onChange 返回激活索引数组。

---

## 适用场景

- 推荐服务标签（内容推荐、搜索推荐）
- 分类筛选标签（人物/地标/食物分类切换）
- 搜索历史词条展示
- 多选标签面板（选择器推荐栏）
- AI 交互渐变按钮
