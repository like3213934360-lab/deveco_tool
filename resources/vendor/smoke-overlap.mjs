// Copyright (c) 2026 Huawei Device Co., Ltd. SPDX-License-Identifier: MIT
// DevEco CLI 67f8db1, smoke/checkers/overlap-analyzer.ts and its layout parsers.
// packages/cli/src/ui/layout/parsers.ts
function normalizeHitTestBehavior(raw) {
  if (!raw || raw === "HitTestMode.Default") {
    return void 0;
  }
  return raw.startsWith("HitTestMode.") ? raw.slice("HitTestMode.".length) : raw;
}
function parseNullableBool(value) {
  if (value === null || value === void 0 || value === "") {
    return void 0;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return void 0;
}
function parseBounds(raw) {
  if (typeof raw !== "string") {
    return void 0;
  }
  const nums = raw.match(/-?\d+/g);
  if (!nums || nums.length < 4) {
    return void 0;
  }
  return [Number(nums[0]), Number(nums[1]), Number(nums[2]), Number(nums[3])];
}

// packages/cli/src/smoke/checkers/overlap-analyzer.ts
var BUILTIN_TYPES = /* @__PURE__ */ new Set([
  "Blank",
  "Button",
  "Checkbox",
  "Column",
  "Divider",
  "Flex",
  "Grid",
  "GridCol",
  "GridRow",
  "Image",
  "List",
  "LoadingProgress",
  "Navigation",
  "NavDestination",
  "Progress",
  "Radio",
  "RelativeContainer",
  "Row",
  "Scroll",
  "Search",
  "Slider",
  "Span",
  "Stack",
  "Swiper",
  "TabContent",
  "Tabs",
  "Text",
  "TextArea",
  "TextInput",
  "Toggle"
]);
var OverlapAnalyzer = class {
  analyze(raw) {
    const tree = LayoutTree.from(raw);
    if (!tree.hasBounds()) {
      return { hits: [], noBounds: true };
    }
    return { hits: new OverlapFinder(tree).find(), noBounds: false };
  }
};
function analyzeOverlap(raw) {
  return new OverlapAnalyzer().analyze(raw);
}
var OverlapReport = class _OverlapReport {
  constructor(hits = []) {
    this.hits = hits;
  }
  static REASON_LIMIT = 3;
  static CANVAS_TOUCH_NOTE = "The layout tree does not show whether Canvas registers onTouch. Read the source to check onTouch and the cover hitTestBehavior before treating this as a real occlusion.";
  format() {
    return this.groups().slice(0, _OverlapReport.REASON_LIMIT).map((group) => this.reasonLine(group)).join("\n");
  }
  conclusion(hit) {
    const cover = hit.cover;
    const name = this.coverTitle(cover);
    const who = this.affectedLabel(hit);
    const pct = this.percent(hit.coverRatio);
    if (hit.confidence < 1) {
      return this.uncertainCanvas(
        who,
        `"${name}" (hitTest=${this.hitTestLabel(cover)})`,
        hit.confidence,
        ` ${pct}%`
      );
    }
    const facts = [
      cover.id ? `id=${cover.id}` : "no id",
      `hitTest=${this.hitTestLabel(cover)}`
    ];
    if (hit.emptyBox) {
      facts.push("no visible content in the overlap");
    }
    const side = hit.direction ? ` (${hit.direction})` : "";
    const advice = hit.emptyBox ? "Yield the covered controls with margin/offset, or set hitTestBehavior(HitTestMode.None) on this empty box" : "Move the cover bounds off the covered controls with margin/offset";
    return `cover "${name}" (${facts.join(", ")}) covers ${who} ${pct}%${side}. ${advice}`;
  }
  groups() {
    const groups = [];
    const indexByKey = /* @__PURE__ */ new Map();
    for (const hit of this.hits) {
      const key = this.coveredKey(hit);
      const index = indexByKey.get(key);
      if (index === void 0) {
        indexByKey.set(key, groups.length);
        groups.push([hit]);
      } else {
        groups[index].push(hit);
      }
    }
    return groups;
  }
  coveredKey(hit) {
    const covered = hit.covered;
    if (covered.id) {
      return `id:${covered.id}`;
    }
    if (covered.path) {
      return `path:${covered.path}`;
    }
    return `type:${covered.type ?? ""}:${covered.text ?? ""}`;
  }
  reasonLine(group) {
    const first = group[0];
    if (typeof first.confidence === "number" && first.confidence < 1) {
      return this.possibleCoverLine(group);
    }
    if (group.length === 1) {
      return first.conclusion ?? this.legacyLine(first);
    }
    return this.confirmedCoverLine(group);
  }
  possibleCoverLine(group) {
    const pcts = group.map((hit) => this.percent(hit.coverRatio));
    const samePct = pcts.every((pct) => pct === pcts[0]);
    const covers = group.map((hit, index) => this.coverPhrase(hit.cover, samePct ? void 0 : pcts[index])).join(", ");
    const leadingPct = samePct ? ` ${pcts[0]}%` : "";
    return this.uncertainCanvas(
      this.affectedLabel(group[0]),
      covers,
      group[0].confidence,
      leadingPct
    );
  }
  confirmedCoverLine(group) {
    const covers = group.map((hit) => `"${this.coverTitle(hit.cover)}" ${this.percent(hit.coverRatio)}%`).join(", ");
    return `${this.affectedLabel(group[0])} is covered by ${covers}.`;
  }
  uncertainCanvas(who, covers, confidence, leadingPct) {
    return `${who} may be covered${leadingPct} by ${covers}, confidence=${confidence}. ` + _OverlapReport.CANVAS_TOUCH_NOTE;
  }
  coverPhrase(cover, pct) {
    const name = this.coverTitle(cover);
    const hitTest = this.hitTestLabel(cover);
    return pct === void 0 ? `"${name}" (hitTest=${hitTest})` : `"${name}" (hitTest=${hitTest}, ${pct}%)`;
  }
  coverTitle(cover) {
    return cover.path || this.nodeLabel(cover);
  }
  hitTestLabel(cover) {
    return cover.hitTest ?? "Default";
  }
  legacyLine(hit) {
    return `${this.nodeLabel(hit.covered)} is ${this.percent(hit.coverRatio)}% covered by ${this.nodeLabel(hit.cover)}`;
  }
  affectedLabel(hit) {
    const ids = hit.affectedIds ?? [];
    if (ids.length > 0) {
      return ids.map((id) => this.labelForAffectedId(hit, id)).join(", ");
    }
    const covered = hit.covered;
    const name = covered.id || covered.path || covered.type || "node";
    return this.quoteText(name, covered.text);
  }
  labelForAffectedId(hit, id) {
    const covered = hit.covered;
    const named = covered.id === id && covered.type ? `${covered.type}#${id}` : id;
    return covered.id === id && covered.text ? `${named} "${covered.text}"` : named;
  }
  nodeLabel(node) {
    let name = "node";
    if (node.type && node.id) {
      name = `${node.type}#${node.id}`;
    } else if (node.type) {
      name = node.type;
    } else if (node.id) {
      name = `#${node.id}`;
    }
    return this.quoteText(name, node.text);
  }
  quoteText(name, text) {
    return text ? `${name} "${text}"` : name;
  }
  percent(ratio) {
    return Math.round(ratio * 100);
  }
};
var OverlapFinder = class _OverlapFinder {
  constructor(tree) {
    this.tree = tree;
  }
  static COVER_RATIO = 0.6;
  /** Canvas geometry is observed; whether it registers onTouch is not. */
  static CANVAS_TOUCH_CONFIDENCE = 0.5;
  static MAX_HITS = 5;
  static OVERLAY_WINDOW_RATIO = 0.85;
  static OVERLAY_MIN_TARGETS = 3;
  report = new OverlapReport();
  find() {
    const kept = this.dropOverlays(this.collect());
    kept.sort((a, b) => b.ratio - a.ratio);
    const limited = this.limitHits(kept);
    const idsByCover = this.affectedIds(limited);
    return limited.map((draft) => this.toHit(draft, idsByCover.get(draft.cover) ?? []));
  }
  /**
   * Keep interaction-evidence hits before the report cap. A lower-ratio
   * clickable target must survive when canvas hints would otherwise fill it.
   */
  limitHits(sorted) {
    const confirmed = [];
    const hints = [];
    for (const hit of sorted) {
      if (hit.confidence >= 1) {
        confirmed.push(hit);
      } else {
        hints.push(hit);
      }
    }
    const kept = confirmed.slice(0, _OverlapFinder.MAX_HITS);
    const room = _OverlapFinder.MAX_HITS - kept.length;
    if (room > 0) {
      kept.push(...hints.slice(0, room));
    }
    return kept;
  }
  collect() {
    const drafts = [];
    for (let targetIndex = 0; targetIndex < this.tree.length; targetIndex++) {
      const target = this.tree.at(targetIndex);
      if (!target.isOcclusionTarget()) {
        continue;
      }
      const bareTouchSurface = target.isBareCanvas();
      for (let coverIndex = 0; coverIndex < this.tree.length; coverIndex++) {
        const draft = this.match(targetIndex, coverIndex, bareTouchSurface);
        if (draft) {
          drafts.push(draft);
        }
      }
    }
    return drafts;
  }
  match(targetIndex, coverIndex, bareTouchSurface) {
    if (coverIndex === targetIndex) {
      return void 0;
    }
    const target = this.tree.at(targetIndex);
    const cover = this.tree.at(coverIndex);
    if (!target.visible || !cover.visible || !cover.inComparison || !cover.intercepts) {
      return void 0;
    }
    if (!this.tree.paintsAbove(coverIndex, targetIndex)) {
      return void 0;
    }
    const overlap = target.visible.intersect(cover.visible);
    if (!overlap || !overlap.isSubstantial()) {
      return void 0;
    }
    const ratio = overlap.area() / target.visibleArea;
    if (ratio < _OverlapFinder.COVER_RATIO || this.childrenFillCanvas(cover, target.visibleArea, overlap, bareTouchSurface)) {
      return void 0;
    }
    return {
      target: targetIndex,
      cover: coverIndex,
      ratio,
      overlap,
      confidence: bareTouchSurface ? _OverlapFinder.CANVAS_TOUCH_CONFIDENCE : 1
    };
  }
  childrenFillCanvas(cover, targetArea, overlap, bareTouchSurface) {
    if (!bareTouchSurface || !cover.contentBounds) {
      return false;
    }
    return this.emptyCoverRatio(cover, targetArea, overlap) < _OverlapFinder.COVER_RATIO;
  }
  emptyCoverRatio(cover, targetArea, overlap) {
    if (targetArea <= 0) {
      return 0;
    }
    const empty = overlap.area() - this.contentOverlapArea(cover, overlap);
    return Math.max(0, empty) / targetArea;
  }
  contentOverlapArea(cover, overlap) {
    if (!cover.contentBounds) {
      return overlap.area();
    }
    return cover.contentBounds.intersect(overlap)?.area() ?? 0;
  }
  dropOverlays(drafts) {
    const dropped = /* @__PURE__ */ new Set([
      ...this.fullscreenCovers(drafts),
      ...this.canvasModalCovers(drafts)
    ]);
    if (dropped.size === 0) {
      return drafts;
    }
    return drafts.filter((hit) => !dropped.has(hit.cover));
  }
  fullscreenCovers(drafts) {
    const overlay = /* @__PURE__ */ new Set();
    const winArea = this.tree.windowArea();
    if (winArea <= 0 || drafts.length === 0) {
      return overlay;
    }
    const counts = /* @__PURE__ */ new Map();
    for (const hit of drafts) {
      counts.set(hit.cover, (counts.get(hit.cover) ?? 0) + 1);
    }
    for (const [index, count] of counts) {
      const node = this.tree.at(index);
      if (count >= _OverlapFinder.OVERLAY_MIN_TARGETS && node.visibleArea >= winArea * _OverlapFinder.OVERLAY_WINDOW_RATIO) {
        overlay.add(index);
      }
    }
    return overlay;
  }
  /**
   * A full-screen modal over a game canvas. The dialog exemption needs three
   * event targets, and a page with one Canvas never qualifies. Drop the cover
   * only when it owns a clickable control and every target is a bare Canvas.
   */
  canvasModalCovers(drafts) {
    const overlay = /* @__PURE__ */ new Set();
    const winArea = this.tree.windowArea();
    if (winArea <= 0 || drafts.length === 0) {
      return overlay;
    }
    const byCover = /* @__PURE__ */ new Map();
    for (const hit of drafts) {
      const list = byCover.get(hit.cover) ?? [];
      list.push(hit);
      byCover.set(hit.cover, list);
    }
    const minArea = winArea * _OverlapFinder.OVERLAY_WINDOW_RATIO;
    for (const [index, hits] of byCover) {
      const cover = this.tree.at(index);
      if (cover.visibleArea < minArea || !cover.hasInteractiveDescendant) {
        continue;
      }
      if (hits.every((hit) => this.tree.at(hit.target).isBareCanvas())) {
        overlay.add(index);
      }
    }
    return overlay;
  }
  affectedIds(drafts) {
    const idsByCover = /* @__PURE__ */ new Map();
    for (const draft of drafts) {
      const id = this.tree.at(draft.target).id;
      if (!id) {
        continue;
      }
      const list = idsByCover.get(draft.cover) ?? [];
      if (!list.includes(id)) {
        list.push(id);
      }
      idsByCover.set(draft.cover, list);
    }
    return idsByCover;
  }
  toHit(draft, ids) {
    const target = this.tree.at(draft.target);
    const cover = this.tree.at(draft.cover);
    const hit = {
      covered: target.toRef(),
      cover: cover.toRef(),
      coverRatio: draft.ratio,
      overlap: draft.overlap.toTuple(),
      direction: draft.overlap.directionToward(
        target.visible ?? draft.overlap,
        cover.bounds ?? draft.overlap
      ),
      emptyBox: this.isEmptyBox(cover, draft.overlap),
      affectedIds: ids,
      confidence: draft.confidence
    };
    hit.conclusion = this.report.conclusion(hit);
    return hit;
  }
  isEmptyBox(cover, overlap) {
    const overlapArea = overlap.area();
    if (overlapArea <= 0) {
      return false;
    }
    return this.contentOverlapArea(cover, overlap) / overlapArea < _OverlapFinder.COVER_RATIO;
  }
};
var LayoutTree = class _LayoutTree {
  constructor(nodes) {
    this.nodes = nodes;
  }
  static from(raw) {
    const tree = new _LayoutTree(_LayoutTree.flatten(raw));
    tree.decorate();
    return tree;
  }
  get length() {
    return this.nodes.length;
  }
  at(index) {
    return this.nodes[index];
  }
  hasBounds() {
    return this.nodes.some((node) => node.bounds);
  }
  windowArea() {
    const root = this.nodes[0];
    if (root?.bounds) {
      return root.bounds.area();
    }
    let box = null;
    for (const node of this.nodes) {
      if (!node.bounds) {
        continue;
      }
      box = box ? box.union(node.bounds) : node.bounds;
    }
    return box?.area() ?? 0;
  }
  /** Cover is painted later, and neither node contains the other. */
  paintsAbove(above, below) {
    const coverLine = this.lineageFromRoot(above);
    const targetLine = this.lineageFromRoot(below);
    let depth = 0;
    while (depth < coverLine.length && depth < targetLine.length && coverLine[depth] === targetLine[depth]) {
      depth++;
    }
    if (depth >= coverLine.length || depth >= targetLine.length) {
      return false;
    }
    return this.at(coverLine[depth]).stacksAbove(this.at(targetLine[depth]));
  }
  decorate() {
    const children = this.childLists();
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      const located = this.locate(i);
      const descendants = this.collectDescendants(children, i);
      node.path = located.path;
      node.ancestors = located.ancestors;
      node.contentBounds = descendants.contentBounds;
      node.descendantIds = descendants.ids;
      node.descendantTypes = descendants.types;
      node.hasInteractiveDescendant = descendants.interactive;
      if (!node.text && descendants.text) {
        node.text = descendants.text;
      }
    }
  }
  childLists() {
    const children = this.nodes.map(() => []);
    for (let i = 0; i < this.nodes.length; i++) {
      const parent = this.nodes[i].parent;
      if (parent >= 0) {
        children[parent].push(i);
      }
    }
    return children;
  }
  locate(index) {
    const segments = this.lineageFromRoot(index).map(
      (nodeIndex, depth) => this.at(nodeIndex).segment(depth === 0)
    );
    return {
      path: segments.join("/"),
      ancestors: segments.slice(0, -1)
    };
  }
  collectDescendants(children, index) {
    const ids = [];
    const types = [];
    let contentBounds = null;
    let interactive = false;
    let text;
    const stack = [...children[index]];
    while (stack.length > 0) {
      const child = stack.pop();
      const node = this.at(child);
      if (node.bounds) {
        contentBounds = contentBounds ? contentBounds.union(node.bounds) : node.bounds;
      }
      if (node.id) {
        LayoutNode.pushCapped(ids, node.id);
      }
      if (node.type && !BUILTIN_TYPES.has(node.type)) {
        LayoutNode.pushCapped(types, node.type);
      }
      if (node.hasEvent || node.type === "Button") {
        interactive = true;
      }
      if (!text && node.text) {
        text = node.text;
      }
      for (const grand of children[child]) {
        stack.push(grand);
      }
    }
    return { contentBounds, ids, types, interactive, text };
  }
  lineageFromRoot(index) {
    const leafToRoot = [];
    let cursor = index;
    while (cursor >= 0) {
      leafToRoot.push(cursor);
      cursor = this.at(cursor).parent;
    }
    leafToRoot.reverse();
    return leafToRoot;
  }
  static flatten(raw) {
    const out = [];
    _LayoutTree.visit(raw, -1, 0, null, out);
    return out;
  }
  static visit(raw, parent, childIndex, ancestorClip, out) {
    const attrs = raw.attributes ?? {};
    const bounds = Bounds.fromDump(parseBounds(attrs.bounds));
    const index = out.length;
    out.push(LayoutNode.fromAttrs(attrs, parent, childIndex, bounds, Bounds.clip(bounds, ancestorClip)));
    const children = raw.children ?? [];
    const childClip = Bounds.clipChildren(attrs, bounds, ancestorClip);
    for (let i = 0; i < children.length; i++) {
      _LayoutTree.visit(children[i], index, i, childClip, out);
    }
  }
};
var LayoutNode = class _LayoutNode {
  constructor(parent, childIndex, zIndex, bounds, visible, ownArea, visibleArea, id, type, text, hasEvent, intercepts, inComparison, hitTest, opacity, shown, backgroundColor) {
    this.parent = parent;
    this.childIndex = childIndex;
    this.zIndex = zIndex;
    this.bounds = bounds;
    this.visible = visible;
    this.ownArea = ownArea;
    this.visibleArea = visibleArea;
    this.id = id;
    this.type = type;
    this.hasEvent = hasEvent;
    this.intercepts = intercepts;
    this.inComparison = inComparison;
    this.hitTest = hitTest;
    this.opacity = opacity;
    this.shown = shown;
    this.backgroundColor = backgroundColor;
    this.text = text;
  }
  static MIN_TARGET_SIDE = 8;
  static MIN_VISIBLE_AREA_RATIO = 0.05;
  static TEXT_LIMIT = 20;
  static DESCENDANT_NOTE_LIMIT = 8;
  path = "";
  ancestors = [];
  contentBounds = null;
  descendantIds = [];
  descendantTypes = [];
  /** A descendant is a Button or has clickable / longClickable / checkable / scrollable. */
  hasInteractiveDescendant = false;
  text;
  static fromAttrs(attrs, parent, childIndex, bounds, visible) {
    const hit = normalizeHitTestBehavior(asString(attrs.hitTestBehavior));
    const transparent = hit === "Transparent";
    const ownArea = bounds?.area() ?? 0;
    const visibleArea = visible?.area() ?? 0;
    return new _LayoutNode(
      parent,
      childIndex,
      _LayoutNode.parseZ(attrs.zIndex),
      bounds,
      visible,
      ownArea,
      visibleArea,
      attrs.id || void 0,
      attrs.type || void 0,
      _LayoutNode.clipText(attrs.originalText || attrs.text),
      _LayoutNode.hasEvent(attrs),
      !transparent && hit !== "None",
      bounds !== null && !transparent && ownArea > 0 && visibleArea / ownArea >= _LayoutNode.MIN_VISIBLE_AREA_RATIO,
      hit ?? "Default",
      asString(attrs.opacity),
      asString(attrs.visible),
      asString(attrs.backgroundColor)
    );
  }
  static pushCapped(list, value) {
    if (list.length < _LayoutNode.DESCENDANT_NOTE_LIMIT && !list.includes(value)) {
      list.push(value);
    }
  }
  isOcclusionTarget() {
    if (!this.inComparison || !this.visible) {
      return false;
    }
    if (!this.hasEvent && !this.isCanvas()) {
      return false;
    }
    return this.visible.shortSide() >= _LayoutNode.MIN_TARGET_SIDE;
  }
  /** Dump does not mark Canvas.onTouch, so a plain Canvas is still a touch target. */
  isBareCanvas() {
    return this.isCanvas() && !this.hasEvent;
  }
  stacksAbove(other) {
    if (this.zIndex !== other.zIndex) {
      return this.zIndex > other.zIndex;
    }
    return this.childIndex > other.childIndex;
  }
  segment(isRoot) {
    const type = this.type ?? "node";
    if (this.id) {
      return `${type}#${this.id}`;
    }
    if (isRoot) {
      return type;
    }
    return `${type}[${this.childIndex}]`;
  }
  toRef() {
    const bounds = this.bounds ?? Bounds.empty();
    return {
      id: this.id,
      type: this.type,
      text: this.text,
      path: this.path,
      ancestors: this.ancestors,
      bounds: bounds.toTuple(),
      contentBounds: this.contentBounds?.toTuple(),
      hitTest: this.hitTest,
      opacity: this.opacity,
      visible: this.shown,
      backgroundColor: this.backgroundColor,
      descendantIds: this.descendantIds,
      descendantTypes: this.descendantTypes
    };
  }
  isCanvas() {
    return this.type === "Canvas";
  }
  static hasEvent(attrs) {
    return parseNullableBool(attrs.clickable) === true || parseNullableBool(attrs.longClickable) === true || parseNullableBool(attrs.checkable) === true || parseNullableBool(attrs.scrollable) === true;
  }
  static parseZ(raw) {
    if (typeof raw !== "string" || raw === "") {
      return 0;
    }
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  static clipText(raw) {
    if (!raw) {
      return void 0;
    }
    return raw.length > _LayoutNode.TEXT_LIMIT ? raw.slice(0, _LayoutNode.TEXT_LIMIT) : raw;
  }
};
var Bounds = class _Bounds {
  constructor(left, top, right, bottom) {
    this.left = left;
    this.top = top;
    this.right = right;
    this.bottom = bottom;
  }
  static MIN_INTERSECTION_PX = 4;
  static FLUSH_PX = 4;
  static BAND_LOW = 0.35;
  static BAND_HIGH = 0.65;
  static fromDump(raw) {
    if (!raw) {
      return null;
    }
    return new _Bounds(raw[0], raw[1], raw[2], raw[3]);
  }
  static empty() {
    return new _Bounds(0, 0, 0, 0);
  }
  static clip(bounds, clip) {
    if (!bounds || !clip) {
      return bounds;
    }
    return bounds.intersect(clip);
  }
  static clipChildren(attrs, bounds, ancestorClip) {
    if (parseNullableBool(attrs.clip) !== true || !bounds) {
      return ancestorClip;
    }
    if (!ancestorClip) {
      return bounds;
    }
    return ancestorClip.intersect(bounds) ?? _Bounds.empty();
  }
  area() {
    const width = this.width();
    const height = this.height();
    return width > 0 && height > 0 ? width * height : 0;
  }
  shortSide() {
    return Math.min(this.width(), this.height());
  }
  isSubstantial() {
    return this.width() >= _Bounds.MIN_INTERSECTION_PX && this.height() >= _Bounds.MIN_INTERSECTION_PX;
  }
  intersect(other) {
    const left = Math.max(this.left, other.left);
    const top = Math.max(this.top, other.top);
    const right = Math.min(this.right, other.right);
    const bottom = Math.min(this.bottom, other.bottom);
    if (right <= left || bottom <= top) {
      return null;
    }
    return new _Bounds(left, top, right, bottom);
  }
  union(other) {
    return new _Bounds(
      Math.min(this.left, other.left),
      Math.min(this.top, other.top),
      Math.max(this.right, other.right),
      Math.max(this.bottom, other.bottom)
    );
  }
  toTuple() {
    return [this.left, this.top, this.right, this.bottom];
  }
  directionToward(covered, cover) {
    if (this.flush(cover.bottom, covered.bottom) && cover.top < covered.top - _Bounds.FLUSH_PX) {
      return "bottom";
    }
    if (this.flush(cover.top, covered.top) && cover.bottom > covered.bottom + _Bounds.FLUSH_PX) {
      return "top";
    }
    const vertical = this.spanRatio(this.top, this.bottom, covered.top, covered.bottom);
    if (vertical >= _Bounds.BAND_HIGH) {
      return "bottom";
    }
    if (vertical <= _Bounds.BAND_LOW) {
      return "top";
    }
    const horizontal = this.spanRatio(this.left, this.right, covered.left, covered.right);
    if (horizontal >= _Bounds.BAND_HIGH) {
      return "right";
    }
    if (horizontal <= _Bounds.BAND_LOW) {
      return "left";
    }
    return "center";
  }
  width() {
    return this.right - this.left;
  }
  height() {
    return this.bottom - this.top;
  }
  flush(a, b) {
    return Math.abs(a - b) <= _Bounds.FLUSH_PX;
  }
  spanRatio(start, end, origin, limit) {
    const span = limit - origin;
    const mid = (start + end) / 2;
    return span > 0 ? (mid - origin) / span : 0.5;
  }
};
function asString(raw) {
  return typeof raw === "string" ? raw : void 0;
}
export {
  analyzeOverlap
};
