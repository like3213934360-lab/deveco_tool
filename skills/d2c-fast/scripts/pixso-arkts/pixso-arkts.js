//#region src/arkui/vendor/arkts-engine.js
function parseCss(css) {
	const result = {};
	if (!css) return result;
	const ruleRegex = /\.([a-zA-Z0-9_%-]+)\s*\{([^}]*)\}/g;
	let match;
	while ((match = ruleRegex.exec(css)) !== null) {
		const className = match[1];
		const declarations = match[2];
		const styleMap = {};
		declarations.split(";").forEach((decl) => {
			const colonIdx = decl.indexOf(":");
			if (colonIdx === -1) return;
			const prop = decl.slice(0, colonIdx).trim();
			const val = decl.slice(colonIdx + 1).replace(/\s*!important\s*$/, "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
			if (prop && val) styleMap[prop] = val;
		});
		result[className] = styleMap;
	}
	return result;
}
parseCss(".text-single {\r\n    display: inline-block;\r\n    white-space: nowrap;\r\n    overflow: hidden;\r\n    text-overflow: ellipsis;\r\n}\r\n\r\n.text-multiple {\r\n    display: inline-block;\r\n    word-break: break-all;\r\n}\r\n\r\n.icon_normal {\r\n    width: 0.875rem;\r\n    height: 0.875rem;\r\n}\r\n\r\n.width-all {\r\n    width: 100% !important;\r\n}\r\n\r\n.relative {\r\n    position: relative;\r\n}\r\n\r\n.absolute {\r\n    position: absolute;\r\n}\r\n\r\n.absolute-top-left {\r\n    top: 0rem;\r\n    left: 0rem;\r\n}\r\n\r\n.flex {\r\n    display: flex;\r\n}\r\n\r\n.align-start {\r\n    align-items: flex-start;\r\n}\r\n\r\n.align-center {\r\n    align-items: center;\r\n}\r\n\r\n.flex-start {\r\n    display: flex;\r\n    justify-content: flex-start;\r\n}\r\n\r\n.flex-between {\r\n    display: flex;\r\n    justify-content: space-between;\r\n}\r\n\r\n.flex-end {\r\n    display: flex;\r\n    justify-content: flex-end;\r\n}\r\n\r\n.flex-align-start {\r\n    display: flex;\r\n    align-items: flex-start;\r\n}\r\n\r\n.flex-align-center {\r\n    display: flex;\r\n    align-items: center;\r\n}\r\n\r\n.flex-align-end {\r\n    display: flex;\r\n    align-items: flex-end;\r\n}\r\n\r\n.flex-start-center {\r\n    display: flex;\r\n    justify-content: flex-start;\r\n    align-items: center;\r\n}\r\n\r\n.flex-between-center {\r\n    display: flex;\r\n    justify-content: space-between;\r\n    align-items: center;\r\n}\r\n\r\n.flex-end-center {\r\n    display: flex;\r\n    justify-content: flex-end;\r\n    align-items: center;\r\n}\r\n\r\n.flex-start-start {\r\n    display: flex;\r\n    justify-content: flex-start;\r\n    align-items: flex-start;\r\n}\r\n\r\n.flex-center-start {\r\n    display: flex;\r\n    justify-content: center;\r\n    align-items: flex-start;\r\n}\r\n\r\n.flex-around-end {\r\n    display: flex;\r\n    justify-content: space-around;\r\n    align-items: flex-end;\r\n}\r\n\r\n.flex-column {\r\n    display: flex;\r\n    flex-direction: column;\r\n}\r\n\r\n.bg-size-all {\r\n    background-size: 100% !important;\r\n}\r\n\r\n.font-large-xxxl {\r\n    font-size: 2.25rem;\r\n}\r\n\r\n.font-large-xxl {\r\n    font-size: 2rem;\r\n}\r\n\r\n.font-large-xl {\r\n    font-size: 1.5rem;\r\n}\r\n\r\n.font-large {\r\n    font-size: 1.25rem;\r\n}\r\n\r\n.font-base {\r\n    font-size: 1rem;\r\n}\r\n\r\n.font-normal {\r\n    font-size: 0.875rem;\r\n}\r\n\r\n.font-small {\r\n    font-size: 0.75rem;\r\n}\r\n\r\n.line-height-1 {\r\n    line-height: 1;\r\n}\r\n\r\n.line-height-normal {\r\n    line-height: 1rem;\r\n}\r\n\r\n.line-height-large {\r\n    line-height: 1.125rem;\r\n}\r\n\r\n.line-height-large-xl {\r\n    line-height: 1.25rem;\r\n}\r\n\r\n.line-height-large-xxl {\r\n    line-height: 1.375rem;\r\n}\r\n\r\n.line-height-large-xxxl {\r\n    line-height: 1.5rem;\r\n}\r\n\r\n.line-height-large-xxxxl {\r\n    line-height: 1.75rem;\r\n}\r\n\r\n.border-radius-base {\r\n    border-radius: 0.25rem;\r\n}\r\n\r\n.border-radius-medium {\r\n    border-radius: 0.5rem;\r\n}\r\n\r\n.border-radius-large {\r\n    border-radius: 0.75rem;\r\n}\r\n\r\n.border-radius-large-xl {\r\n    border-radius: 0.875rem;\r\n}\r\n\r\n.border-radius-large-xxl {\r\n    border-radius: 1rem;\r\n}\r\n\r\n.border-radius-large-xxxl {\r\n    border-radius: 1.25rem;\r\n}\r\n\r\n.icon-size-8 {\r\n    width: 0.5rem;\r\n    height: 0.5rem;\r\n}\r\n\r\n.icon-size-10 {\r\n    width: 0.625rem;\r\n    height: 0.625rem;\r\n}\r\n\r\n.icon-size-12 {\r\n    width: 0.75rem;\r\n    height: 0.75rem;\r\n}\r\n\r\n.icon-size-14 {\r\n    width: 0.875rem;\r\n    height: 0.875rem;\r\n}\r\n\r\n.icon-size-16 {\r\n    width: 1rem;\r\n    height: 1rem;\r\n}\r\n\r\n.icon-size-20 {\r\n    width: 1.25rem;\r\n    height: 1.25rem;\r\n}\r\n\r\n.icon-size-24 {\r\n    width: 1.5rem;\r\n    height: 1.5rem;\r\n}\r\n\r\n.icon-size-32 {\r\n    width: 2rem;\r\n    height: 2rem;\r\n}\r\n\r\n.icon-size-36 {\r\n    width: 2.25rem;\r\n    height: 2.25rem;\r\n}\r\n\r\n.icon-size-36 {\r\n    width: 2.25rem;\r\n    height: 2.25rem;\r\n}\r\n\r\n.icon-size-40 {\r\n    width: 2.5rem;\r\n    height: 2.5rem;\r\n}\r\n\r\n.icon-size-48 {\r\n    width: 3rem;\r\n    height: 3rem;\r\n}\r\n\r\n.icon-size-48 {\r\n    width: 3rem;\r\n    height: 3rem;\r\n}\r\n\r\n.icon-size-50 {\r\n    width: 3.125rem;\r\n    height: 3.125rem;\r\n}\r\n\r\n.icon-size-64 {\r\n    width: 4rem;\r\n    height: 4rem;\r\n}\r\n\r\n.icon-size-72 {\r\n    width: 4.5rem;\r\n    height: 4.5rem;\r\n}\r\n\r\n.margin-bottom-4 {\r\n    margin-bottom: 0.25rem;\r\n}\r\n\r\n.margin-bottom-8 {\r\n    margin-bottom: 0.5rem;\r\n}\r\n\r\n.margin-bottom-12 {\r\n    margin-bottom: 0.75rem;\r\n}\r\n\r\n.margin-bottom-14 {\r\n    margin-bottom: 0.875rem;\r\n}\r\n\r\n.margin-bottom-16 {\r\n    margin-bottom: 1rem;\r\n}\r\n\r\n.margin-bottom-20 {\r\n    margin-bottom: 1.25rem;\r\n}\r\n\r\n.margin-bottom-24 {\r\n    margin-bottom: 1.5rem;\r\n}\r\n\r\n.margin-bottom-32 {\r\n    margin-bottom: 2rem;\r\n}\r\n\r\n.margin-bottom-40 {\r\n    margin-bottom: 2.5rem;\r\n}\r\n\r\n.margin-bottom-48 {\r\n    margin-bottom: 3rem;\r\n}\r\n\r\n.margin-right-4 {\r\n    margin-right: 0.25rem;\r\n}\r\n\r\n.margin-right-8 {\r\n    margin-right: 0.5rem;\r\n}\r\n\r\n.margin-right-12 {\r\n    margin-right: 0.75rem;\r\n}\r\n\r\n.margin-right-14 {\r\n    margin-right: 0.875rem;\r\n}\r\n\r\n.margin-right-16 {\r\n    margin-right: 1rem;\r\n}\r\n\r\n.margin-right-20 {\r\n    margin-right: 1.25rem;\r\n}\r\n\r\n.margin-right-24 {\r\n    margin-right: 1.5rem;\r\n}\r\n\r\n.margin-right-32 {\r\n    margin-right: 2rem;\r\n}\r\n\r\n.margin-right-40 {\r\n    margin-right: 2.5rem;\r\n}\r\n\r\n.margin-right-48 {\r\n    margin-right: 3rem;\r\n}\r\n\r\n.margin-top-4 {\r\n    margin-top: 0.25rem;\r\n}\r\n\r\n.margin-top-8 {\r\n    margin-top: 0.5rem;\r\n}\r\n\r\n.margin-top-16 {\r\n    margin-top: 1rem;\r\n}\r\n\r\n.margin-left-4 {\r\n    margin-left: 0.25rem;\r\n}\r\n\r\n.margin-left-8 {\r\n    margin-left: 0.5rem;\r\n}\r\n\r\n.margin-left-16 {\r\n    margin-left: 1rem;\r\n}\r\n\r\n.padding-4 {\r\n    padding: 0.25rem;\r\n}\r\n\r\n.padding-8 {\r\n    padding: 0.5rem;\r\n}\r\n\r\n.padding-16 {\r\n    padding: 1rem;\r\n}\r\n\r\n.text-center {\r\n    text-align: center;\r\n}\r\n\r\n.text-right {\r\n    text-align: right;\r\n}\r\n\r\n.text-white {\r\n    --tw-text-opacity: 1;\r\n    color: rgb(255 255 255 / var(--tw-text-opacity, 1));\r\n}\r\n\r\n* {\r\n    box-sizing: border-box;\r\n}");
var skipNodeGuids = /* @__PURE__ */ new Set();
var systemBarsInfo = null;
var containersToAdjustHeight = /* @__PURE__ */ new Map();
function getContainerHeightReduce(nodeId) {
	return containersToAdjustHeight.get(nodeId) ?? 0;
}
function setSkipNodeGuids(guids) {
	skipNodeGuids = guids;
}
function clearSkipNodeGuids() {
	skipNodeGuids = /* @__PURE__ */ new Set();
}
function setSystemBarsInfo(info) {
	systemBarsInfo = info;
}
function clearSystemBarsInfo() {
	systemBarsInfo = null;
}
function clearContainersToAdjustHeight() {
	containersToAdjustHeight = /* @__PURE__ */ new Map();
}
function parseStyleNum(val, defaultVal = 0) {
	if (typeof val === "number") return val;
	if (typeof val === "string") {
		const n = parseFloat(val);
		return isNaN(n) ? defaultVal : n;
	}
	return defaultVal;
}
function extractV2Margin(styles) {
	if (!styles) return [0, 0];
	const margin = styles.margin;
	if (margin === void 0) return [parseStyleNum(styles["marginTop"]), parseStyleNum(styles["marginBottom"])];
	if (typeof margin === "number") return [margin, margin];
	if (typeof margin === "string") {
		const parts = margin.trim().split(/\s+/).map((p) => parseFloat(p) || 0);
		if (parts.length === 1) return [parts[0], parts[0]];
		if (parts.length === 2) return [parts[0], parts[0]];
		if (parts.length === 3) return [parts[0], parts[2]];
		return [parts[0] || 0, parts[2] || 0];
	}
	const obj = margin;
	return [parseStyleNum(obj["top"]), parseStyleNum(obj["bottom"])];
}
function computeNodeOccupiedHeightV2(node) {
	const styles = node.styles ?? {};
	const height = parseStyleNum(styles["height"], 0);
	const [marginTop, marginBottom] = extractV2Margin(styles);
	return height + marginTop + marginBottom;
}
function getV2NodeTop(node) {
	var _a;
	const styles = node.styles;
	if ((styles == null ? void 0 : styles.top) !== void 0) return parseStyleNum(styles.top);
	if (((_a = node.meta) == null ? void 0 : _a.bbox) && node.meta.bbox.length >= 4) return node.meta.bbox[1];
	return 0;
}
function isSystemBarNodeV2(node) {
	var _a;
	const rawName = ((_a = node.meta) == null ? void 0 : _a.octoName) ?? node.name;
	const name = typeof rawName === "string" ? rawName : String(rawName ?? "");
	if (name.endsWith("StatusBar") || name.endsWith("Aibottombar") || name.endsWith("BottomBar")) return true;
	if (name === "矩形" && node.styles) {
		const styles = node.styles;
		const hasAbsolute2 = styles.position === "absolute" || node.componentName === "Stack";
		const backdropBlur = styles.backdropFilter;
		const hasBackdropBlur = typeof backdropBlur === "string" && backdropBlur.includes("blur");
		if (hasAbsolute2 && hasBackdropBlur) {
			const occupiedHeight = computeNodeOccupiedHeightV2(node);
			if (occupiedHeight > 0 && occupiedHeight < 10) return true;
		}
	}
	return false;
}
function scanAndSetupSystemBarsV2(children, rootNode) {
	var _a, _b, _c, _d, _e, _f, _g;
	const skipGuids = /* @__PURE__ */ new Set();
	let statusBarTop = Infinity;
	let statusBarBottom = 0;
	let bottomBarTop = Infinity;
	let bottomBarBottom = 0;
	let compensationContainerGuid = null;
	const heightAdjustMap = /* @__PURE__ */ new Map();
	function addHeightToAncestors(ancestors, occupiedHeight) {
		var _a2, _b2;
		for (const ancestor of ancestors) {
			const ancestorId = (_a2 = ancestor.meta) == null ? void 0 : _a2.octoId;
			if (!ancestorId) continue;
			const rawHeight = (_b2 = ancestor.styles) == null ? void 0 : _b2.height;
			if (rawHeight === void 0) continue;
			if (isNaN(typeof rawHeight === "number" ? rawHeight : parseFloat(String(rawHeight)))) continue;
			if (typeof rawHeight === "string" && rawHeight.includes("%")) continue;
			const existing = heightAdjustMap.get(ancestorId) ?? 0;
			heightAdjustMap.set(ancestorId, Math.max(existing, occupiedHeight));
		}
	}
	function walk(node, parent, ancestors) {
		var _a2, _b2, _c2, _d2;
		const rawName = ((_a2 = node.meta) == null ? void 0 : _a2.octoName) ?? node.name;
		const name = typeof rawName === "string" ? rawName : String(rawName ?? "");
		if (isSystemBarNodeV2(node)) {
			const nodeId = (_b2 = node.meta) == null ? void 0 : _b2.octoId;
			if (nodeId) skipGuids.add(nodeId);
			if (!compensationContainerGuid && ((_c2 = parent == null ? void 0 : parent.meta) == null ? void 0 : _c2.octoId)) compensationContainerGuid = parent.meta.octoId;
			const nodeTop = getV2NodeTop(node);
			const occupiedHeight = computeNodeOccupiedHeightV2(node);
			if (name.includes("StatusBar")) {
				statusBarTop = Math.min(statusBarTop, nodeTop);
				statusBarBottom = Math.max(statusBarBottom, nodeTop + occupiedHeight);
			} else if (name.includes("BottomBar")) {
				bottomBarTop = Math.min(bottomBarTop, nodeTop);
				bottomBarBottom = Math.max(bottomBarBottom, nodeTop + occupiedHeight);
			}
			addHeightToAncestors(ancestors, occupiedHeight);
		}
		if ((_d2 = node.children) == null ? void 0 : _d2.length) for (const child of node.children) walk(child, node, [...ancestors, node]);
	}
	for (const child of children) walk(child, null, []);
	const statusBarHeight = statusBarBottom > 0 && statusBarTop !== Infinity ? statusBarBottom - statusBarTop : 0;
	const bottomBarHeight = bottomBarBottom > 0 && bottomBarTop !== Infinity ? bottomBarBottom - bottomBarTop : 0;
	if (statusBarHeight > 0) {
		if (rootNode) {
			const h = (_a = rootNode.styles) == null ? void 0 : _a.height;
			const rootId = (_b = rootNode.meta) == null ? void 0 : _b.octoId;
			if (h !== void 0 && rootId) {
				if (!(typeof h === "string" && h.includes("%"))) {
					const existing = heightAdjustMap.get(rootId) ?? 0;
					heightAdjustMap.set(rootId, Math.max(existing, statusBarHeight));
				}
			}
		} else if (children.length > 0) for (const child of children) {
			const h = (_c = child.styles) == null ? void 0 : _c.height;
			if (h === void 0) continue;
			if (typeof h === "string" && h.includes("%")) continue;
			const rootId = (_d = child.meta) == null ? void 0 : _d.octoId;
			if (!rootId) continue;
			const existing = heightAdjustMap.get(rootId) ?? 0;
			heightAdjustMap.set(rootId, Math.max(existing, statusBarHeight));
			break;
		}
	}
	if (rootNode && statusBarHeight > 0) {
		const rootHeight = parseStyleNum((_e = rootNode.styles) == null ? void 0 : _e.height, 0);
		const bgImageChildren = rootNode.children ?? [];
		for (const child of bgImageChildren) {
			if (child.componentName !== "Image") continue;
			const childHeight = parseStyleNum((_f = child.styles) == null ? void 0 : _f.height, 0);
			if (childHeight <= 0) continue;
			if (Math.abs(childHeight - rootHeight) > 100) continue;
			const childId = (_g = child.meta) == null ? void 0 : _g.octoId;
			if (!childId) continue;
			const existing = heightAdjustMap.get(childId) ?? 0;
			heightAdjustMap.set(childId, Math.max(existing, statusBarHeight));
		}
	}
	containersToAdjustHeight = heightAdjustMap;
	return {
		skipGuids,
		systemBarsInfo: statusBarHeight > 0 || bottomBarHeight > 0 ? {
			statusBarHeight,
			statusBarTop: statusBarTop === Infinity ? 0 : statusBarTop,
			bottomBarHeight,
			bottomBarBottom,
			compensationContainerGuid
		} : null
	};
}
function shouldSkipNodeV2(node) {
	var _a;
	const nodeId = (_a = node.meta) == null ? void 0 : _a.octoId;
	return nodeId ? skipNodeGuids.has(nodeId) : false;
}
function compensatePositionV2(pos) {
	if (!pos || !systemBarsInfo) return pos;
	const { statusBarHeight, statusBarTop, bottomBarHeight } = systemBarsInfo;
	const compensated = { ...pos };
	if (compensated.y !== void 0 && compensated.y >= statusBarTop && statusBarHeight > 0) compensated.y = Math.max(0, compensated.y - statusBarHeight);
	if (compensated.bottom !== void 0 && bottomBarHeight > 0) compensated.bottom = compensated.bottom + bottomBarHeight;
	return compensated;
}
function normalizeColorToArkUI(hex) {
	hex = hex.trim();
	const rgbaMatch = hex.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/i);
	if (rgbaMatch) {
		const r = parseInt(rgbaMatch[1]).toString(16).padStart(2, "0");
		const g = parseInt(rgbaMatch[2]).toString(16).padStart(2, "0");
		const b = parseInt(rgbaMatch[3]).toString(16).padStart(2, "0");
		return `#${rgbaMatch[4] !== void 0 ? Math.round(parseFloat(rgbaMatch[4]) * 255).toString(16).padStart(2, "0") : "FF"}${r}${g}${b}`.toUpperCase();
	}
	if (!hex.startsWith("#")) return hex;
	if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
		const r = hex[1];
		const g = hex[2];
		const b = hex[3];
		return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
	}
	if (/^#[0-9a-fA-F]{4}$/.test(hex)) {
		const r = hex[1];
		const g = hex[2];
		const b = hex[3];
		const a = hex[4];
		return `#${a}${a}${r}${r}${g}${g}${b}${b}`.toUpperCase();
	}
	if (/^#[0-9a-fA-F]{8}$/.test(hex)) return hex.toUpperCase();
	if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toUpperCase();
	return hex;
}
function urlToBackgroundRes(url) {
	if (url.startsWith("http://") || url.startsWith("https://")) return `"${url}"`;
	const name = url.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").replace(/-/g, "_");
	return name ? `$r('app.media.${name}')` : "\"\"";
}
function isSimpleIdentifier(val) {
	return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(val);
}
function convertEdges(value) {
	if (value === void 0) return "";
	if (typeof value === "number") return String(value);
	if (typeof value === "string") return value;
	const parts = [];
	if (value.top !== void 0) {
		const v = typeof value.top === "string" && isSimpleIdentifier(value.top) ? value.top : String(value.top);
		parts.push(`top: ${v}`);
	}
	if (value.right !== void 0) {
		const v = typeof value.right === "string" && isSimpleIdentifier(value.right) ? value.right : String(value.right);
		parts.push(`right: ${v}`);
	}
	if (value.bottom !== void 0) {
		const v = typeof value.bottom === "string" && isSimpleIdentifier(value.bottom) ? value.bottom : String(value.bottom);
		parts.push(`bottom: ${v}`);
	}
	if (value.left !== void 0) {
		const v = typeof value.left === "string" && isSimpleIdentifier(value.left) ? value.left : String(value.left);
		parts.push(`left: ${v}`);
	}
	if (parts.length === 0) return "";
	if (parts.length === 1) return `{ ${parts[0].split(": ")[0]}: ${parts[0].split(": ")[1]} }`;
	return `{ ${parts.join(", ")} }`;
}
function convertShadow(shadow) {
	const s = (Array.isArray(shadow) ? shadow : [shadow])[0];
	return `.shadow({ radius: ${s.radius ?? 0}, color: ${s.color ? `"${normalizeColorToArkUI(s.color)}"` : "Color.Black"}, offsetX: ${s.offsetX ?? 0}, offsetY: ${s.offsetY ?? 0} })`;
}
function convertLinearGradient(value) {
	const match = value.match(/linear-gradient\s*\((.+)\)\s*$/is);
	if (!match) return null;
	const inner = match[1];
	const parts = [];
	let depth = 0;
	let cur = "";
	for (const ch of inner) if (ch === "(") {
		depth++;
		cur += ch;
	} else if (ch === ")") {
		depth--;
		cur += ch;
	} else if (ch === "," && depth === 0) {
		parts.push(cur.trim());
		cur = "";
	} else cur += ch;
	if (cur.trim()) parts.push(cur.trim());
	if (parts.length < 2) return null;
	let angle = 180;
	let colorStart = 0;
	const firstPart = parts[0].trim();
	const degMatch = firstPart.match(/^(-?\d+(?:\.\d+)?)\s*deg$/i);
	if (degMatch) {
		angle = parseFloat(degMatch[1]);
		colorStart = 1;
	} else if (/^to\s+/i.test(firstPart)) {
		angle = {
			bottom: 180,
			top: 0,
			right: 90,
			left: 270
		}[firstPart.replace(/^to\s+/i, "").trim().toLowerCase()] ?? 180;
		colorStart = 1;
	}
	const colors = [];
	const total = parts.length - colorStart;
	for (let i = colorStart; i < parts.length; i++) {
		const seg = parts[i].trim();
		const spaceIdx = seg.lastIndexOf(" ");
		let color;
		let stop;
		if (spaceIdx !== -1) {
			const afterSpace = seg.slice(spaceIdx + 1).trim();
			if (/^[\d.]+%?$/.test(afterSpace)) {
				color = seg.slice(0, spaceIdx).trim();
				stop = afterSpace;
			} else {
				color = seg;
				stop = "";
			}
		} else {
			color = seg;
			stop = "";
		}
		const normalizedColor = normalizeColorValue(color);
		let stopNum;
		if (stop.endsWith("%")) stopNum = String(parseFloat(stop) / 100);
		else if (stop) stopNum = stop;
		else stopNum = String(Math.round((i - colorStart) / (total - 1) * 1e3) / 1e3);
		colors.push(`['${normalizedColor}', ${stopNum}]`);
	}
	return `.linearGradient({ angle: ${angle}, colors: [${colors.join(", ")}] })`;
}
function normalizeColorValue(color) {
	return normalizeColorToArkUI(color);
}
function convertBorderRadius(value) {
	if (typeof value === "number" || typeof value === "string") return String(value);
	const corners = value;
	const tl = corners.topLeft ?? 0;
	const tr = corners.topRight ?? 0;
	const br = corners.bottomRight ?? 0;
	const bl = corners.bottomLeft ?? 0;
	if (tl === tr && tr === br && br === bl) return String(tl);
	return `{ topLeft: ${tl}, topRight: ${tr}, bottomRight: ${br}, bottomLeft: ${bl} }`;
}
var ALIGN_ITEMS_MAP = {
	Start: "HorizontalAlign.Start",
	End: "HorizontalAlign.End",
	Center: "HorizontalAlign.Center",
	Stretch: "HorizontalAlign.Center"
};
var ALIGN_ITEMS_MAP_ROW = {
	Start: "VerticalAlign.Top",
	End: "VerticalAlign.Bottom",
	Center: "VerticalAlign.Center",
	Stretch: "VerticalAlign.Center"
};
var SKIP_STYLE_KEYS = /* @__PURE__ */ new Set([
	"alignItems",
	"justifyContent",
	"space",
	"flexDirection",
	"columnsTemplate",
	"rowsTemplate",
	"columnsGap",
	"rowsGap"
]);
var BORDER_SIDE_SHORTHANDS = [
	"borderTopWidth",
	"borderRightWidth",
	"borderBottomWidth",
	"borderLeftWidth",
	"borderTopColor",
	"borderRightColor",
	"borderBottomColor",
	"borderLeftColor",
	"borderTopStyle",
	"borderRightStyle",
	"borderBottomStyle",
	"borderLeftStyle"
];
var MARGIN_SHORTHANDS = [
	"marginTop",
	"marginRight",
	"marginBottom",
	"marginLeft"
];
var PADDING_SHORTHANDS = [
	"paddingTop",
	"paddingRight",
	"paddingBottom",
	"paddingLeft"
];
function mergeShorthandBorderSides(styles) {
	const sides = [
		"top",
		"right",
		"bottom",
		"left"
	];
	const widthParts = [];
	const colorParts = [];
	const styleParts = [];
	for (const side of sides) {
		const sideKey = side.charAt(0).toUpperCase() + side.slice(1);
		const wKey = `border${sideKey}Width`;
		const cKey = `border${sideKey}Color`;
		const sKey = `border${sideKey}Style`;
		const w = styles[wKey];
		const c = styles[cKey];
		const s = styles[sKey];
		if (w !== void 0 || c !== void 0 || s !== void 0) {
			const widthVal = w !== void 0 ? parsePxValue(String(w)) : 0;
			widthParts.push(`${side}: ${widthVal}`);
			const colorVal = c ? `"${normalizeColorToArkUI(String(c))}"` : "\"#000000\"";
			colorParts.push(`${side}: ${colorVal}`);
			const styleVal = s === "Dashed" ? "BorderStyle.Dashed" : s === "Dotted" ? "BorderStyle.Dotted" : "BorderStyle.Solid";
			styleParts.push(`${side}: ${styleVal}`);
		}
	}
	if (widthParts.length === 0) return null;
	return `.border({ width: { ${widthParts.join(", ")} }, color: { ${colorParts.join(", ")} }, style: { ${styleParts.join(", ")} } })`;
}
function parsePxValue(value) {
	const match = value.match(/^([\d.]+)\s*px$/i);
	return match ? parseFloat(match[1]) : parseFloat(value) || 0;
}
function parseCssBoxShadow(boxShadow) {
	const result = [];
	const shadows = splitBoxShadowLayers(boxShadow);
	for (const shadow of shadows) {
		const s = shadow.trim();
		if (!s) continue;
		const isInset = s.startsWith("inset");
		let remaining = s;
		if (isInset) remaining = remaining.replace(/^inset\s+/, "");
		let color = "";
		const leadingColor = remaining.match(/^(rgba?\s*\([^)]+\)|#[0-9a-fA-F]{3,8})\s*(.*)$/i);
		if (leadingColor) {
			color = leadingColor[1];
			remaining = leadingColor[2];
		} else {
			const trailingColor = remaining.match(/^(.*?)\s+(rgba?\s*\([^)]+\)|#[0-9a-fA-F]{3,8})\s*$/i);
			if (trailingColor) {
				color = trailingColor[2];
				remaining = trailingColor[1];
			}
		}
		const lengths = [];
		const lengthRegex = /(-?[\d.]+)(px)?/g;
		let m;
		while ((m = lengthRegex.exec(remaining)) !== null) lengths.push(parseFloat(m[1]));
		result.push({
			offsetX: lengths[0] ?? 0,
			offsetY: lengths[1] ?? 0,
			radius: lengths[2] ?? 0,
			spread: lengths[3] ?? 0,
			color: color || "#000000",
			inset: isInset
		});
	}
	return result;
}
function splitBoxShadowLayers(value) {
	const parts = [];
	let depth = 0;
	let cur = "";
	for (const ch of value) if (ch === "(") {
		depth++;
		cur += ch;
	} else if (ch === ")") {
		depth--;
		cur += ch;
	} else if (ch === "," && depth === 0) {
		parts.push(cur.trim());
		cur = "";
	} else cur += ch;
	if (cur.trim()) parts.push(cur.trim());
	return parts;
}
function isTransparentColor$2(color) {
	const c = color.trim().toLowerCase();
	if (c === "transparent") return true;
	if (/^#0{4}$/i.test(c) || /^#0{8}$/i.test(c)) return true;
	if (c.match(/^rgba\s*\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0*)?\s*\)$/)) return true;
	return false;
}
function convertBoxShadowString(boxShadow) {
	const shadows = parseCssBoxShadow(boxShadow);
	if (shadows.length === 0) return null;
	let target = null;
	for (const s of shadows) if (!s.inset && !isTransparentColor$2(s.color)) {
		target = s;
		break;
	}
	if (!target) {
		for (const s of shadows) if (!s.inset) {
			target = s;
			break;
		}
	}
	if (!target) return null;
	return `.shadow({ radius: ${Math.max(target.radius, .1)}, color: ${`"${normalizeColorToArkUI(target.color)}"`}, offsetX: ${target.offsetX}, offsetY: ${target.offsetY} })`;
}
var TEXT_STYLE_PROPS = /* @__PURE__ */ new Set([
	"fontSize",
	"fontColor",
	"fontWeight",
	"lineHeight",
	"textAlign",
	"fontFamily"
]);
var CONTAINER_COMPONENTS = /* @__PURE__ */ new Set([
	"Column",
	"Row",
	"Stack",
	"Scroll",
	"Flex",
	"List",
	"ListItem",
	"Grid",
	"HdsListItem",
	"HdsListItemCard",
	"HdsActionBar",
	"HdsNavDestination",
	"HdsNavigation",
	"HdsSideBar",
	"HdsSideMenu",
	"HdsSnackBar",
	"HdsTabs",
	"HdsVisualComponent",
	"Button",
	"Search",
	"Toggle",
	"Image"
]);
var NO_ALIGN_ITEMS_COMPONENTS = /* @__PURE__ */ new Set([
	"Stack",
	"List",
	"ListItem",
	"Navigation"
]);
function mergeShorthandEdges(styles) {
	const result = { ...styles };
	if (MARGIN_SHORTHANDS.some((k) => styles[k] !== void 0)) {
		const existingMargin = styles.margin;
		let margin;
		if (typeof existingMargin === "number") margin = {
			top: existingMargin,
			right: existingMargin,
			bottom: existingMargin,
			left: existingMargin
		};
		else if (typeof existingMargin === "object" && existingMargin !== null) margin = { ...existingMargin };
		else margin = {};
		if (styles.marginTop !== void 0 && styles.marginTop !== "auto") margin.top = styles.marginTop;
		if (styles.marginRight !== void 0 && styles.marginRight !== "auto") margin.right = styles.marginRight;
		if (styles.marginBottom !== void 0 && styles.marginBottom !== "auto") margin.bottom = styles.marginBottom;
		if (styles.marginLeft !== void 0 && styles.marginLeft !== "auto") margin.left = styles.marginLeft;
		result.margin = margin;
	}
	if (PADDING_SHORTHANDS.some((k) => styles[k] !== void 0)) {
		const existingPadding = styles.padding;
		let padding;
		if (typeof existingPadding === "number") padding = {
			top: existingPadding,
			right: existingPadding,
			bottom: existingPadding,
			left: existingPadding
		};
		else if (typeof existingPadding === "object" && existingPadding !== null) padding = { ...existingPadding };
		else padding = {};
		if (styles.paddingTop !== void 0) padding.top = styles.paddingTop;
		if (styles.paddingRight !== void 0) padding.right = styles.paddingRight;
		if (styles.paddingBottom !== void 0) padding.bottom = styles.paddingBottom;
		if (styles.paddingLeft !== void 0) padding.left = styles.paddingLeft;
		result.padding = padding;
	}
	return result;
}
function v2StylesToArkUI(styles, componentName, indent, options) {
	if (!styles) return [];
	const lines = [];
	const mergedStyles = mergeShorthandEdges(styles);
	const skipTextStyles = CONTAINER_COMPONENTS.has(componentName);
	for (const [key, value] of Object.entries(mergedStyles)) {
		if (value === void 0 || value === null || SKIP_STYLE_KEYS.has(key)) continue;
		if (skipTextStyles && TEXT_STYLE_PROPS.has(key)) continue;
		if (MARGIN_SHORTHANDS.includes(key) || PADDING_SHORTHANDS.includes(key)) continue;
		if (BORDER_SIDE_SHORTHANDS.includes(key)) continue;
		switch (key) {
			case "width":
				if (typeof value === "number") lines.push(`${indent}.width(${value})`);
				else if (typeof value === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) lines.push(`${indent}.width(${value})`);
				else lines.push(`${indent}.width("${value}")`);
				break;
			case "height":
				if (typeof value === "number") lines.push(`${indent}.height(${value})`);
				else if (typeof value === "string" && isSimpleIdentifier(value)) lines.push(`${indent}.height(${value})`);
				else lines.push(`${indent}.height("${value}")`);
				break;
			case "backgroundColor":
				if (!(options == null ? void 0 : options.skipBackgroundColor)) if (typeof value === "string" && isSimpleIdentifier(value)) lines.push(`${indent}.backgroundColor(${value})`);
				else lines.push(`${indent}.backgroundColor("${normalizeColorToArkUI(String(value))}")`);
				break;
			case "backgroundImage": {
				if (options == null ? void 0 : options.skipBackgroundImage) break;
				const m = String(value).match(/url\(["']?([^"')]+)["']?\)/);
				if (m) {
					const url = m[1];
					const res = urlToBackgroundRes(url);
					lines.push(`${indent}.backgroundImage(${res})`);
				}
				break;
			}
			case "backgroundSize": {
				if (options == null ? void 0 : options.skipBackgroundImage) break;
				const v = String(value).trim().toLowerCase();
				if (v === "cover" || v === "100%" || v === "100% 100%") lines.push(`${indent}.backgroundImageSize(ImageSize.Cover)`);
				else if (v === "contain") lines.push(`${indent}.backgroundImageSize(ImageSize.Contain)`);
				else lines.push(`${indent}.backgroundImageSize(ImageSize.Auto)`);
				break;
			}
			case "borderRadius": {
				if (options == null ? void 0 : options.skipBorderRadius) break;
				const v = convertBorderRadius(value);
				lines.push(`${indent}.borderRadius(${v})`);
				break;
			}
			case "margin": {
				let mv = value;
				if ((options == null ? void 0 : options.hasPosition) && typeof mv === "object" && mv !== null) {
					const filtered = { ...mv };
					delete filtered.top;
					delete filtered.left;
					mv = filtered;
				}
				const v = convertEdges(mv);
				if (v) lines.push(`${indent}.margin(${v})`);
				break;
			}
			case "padding": {
				const v = convertEdges(value);
				if (v) lines.push(`${indent}.padding(${v})`);
				break;
			}
			case "fontSize":
				if (typeof value === "number") lines.push(`${indent}.fontSize(${value})`);
				else if (typeof value === "string" && isSimpleIdentifier(value)) lines.push(`${indent}.fontSize(${value})`);
				else lines.push(`${indent}.fontSize(${value})`);
				break;
			case "fontColor":
				if (typeof value === "string" && isSimpleIdentifier(value)) lines.push(`${indent}.fontColor(${value})`);
				else lines.push(`${indent}.fontColor("${normalizeColorToArkUI(String(value))}")`);
				break;
			case "fontWeight":
				if (typeof value === "number") lines.push(`${indent}.fontWeight(${value})`);
				else if (typeof value === "string" && isSimpleIdentifier(value)) lines.push(`${indent}.fontWeight(${value})`);
				else if (value === "bold") lines.push(`${indent}.fontWeight(FontWeight.Bold)`);
				else if (value === "normal") lines.push(`${indent}.fontWeight(FontWeight.Normal)`);
				else lines.push(`${indent}.fontWeight(${value})`);
				break;
			case "lineHeight":
				if (typeof value === "number") lines.push(`${indent}.lineHeight(${value})`);
				else if (typeof value === "string" && isSimpleIdentifier(value)) lines.push(`${indent}.lineHeight(${value})`);
				else lines.push(`${indent}.lineHeight(${value})`);
				break;
			case "textAlign": {
				const v = String(value).toLowerCase();
				const map = {
					center: "TextAlign.Center",
					right: "TextAlign.End",
					end: "TextAlign.End",
					left: "TextAlign.Start",
					start: "TextAlign.Start"
				};
				if (map[v]) lines.push(`${indent}.textAlign(${map[v]})`);
				break;
			}
			case "objectFit": {
				const v = String(value);
				const map = {
					Cover: "ImageFit.Cover",
					Contain: "ImageFit.Contain",
					Fill: "ImageFit.Fill",
					Auto: "ImageFit.Auto",
					ScaleDown: "ImageFit.ScaleDown",
					None: "ImageFit.None"
				};
				if (map[v]) lines.push(`${indent}.objectFit(${map[v]})`);
				break;
			}
			case "fontFamily":
				lines.push(`${indent}.fontFamily("${value}")`);
				break;
			case "opacity":
				lines.push(`${indent}.opacity(${value})`);
				break;
			case "layoutWeight":
				lines.push(`${indent}.layoutWeight(${value})`);
				break;
			case "overflow":
				if (value === "hidden") lines.push(`${indent}.clip(true)`);
				break;
			case "border": {
				const b = value;
				if (b.width !== void 0 || b.color !== void 0 || b.style !== void 0) {
					const w = typeof b.width === "number" ? b.width : 0;
					const c = b.color ? `"${normalizeColorToArkUI(b.color)}"` : "\"#000000\"";
					const s = b.style === "Dashed" ? "BorderStyle.Dashed" : b.style === "Dotted" ? "BorderStyle.Dotted" : "BorderStyle.Solid";
					lines.push(`${indent}.border({ width: ${w}, color: ${c}, style: ${s} })`);
				}
				break;
			}
			case "shadow":
				lines.push(`${indent}${convertShadow(value)}`);
				break;
			case "linearGradient": {
				const grad = convertLinearGradient(String(value));
				if (grad) lines.push(`${indent}${grad}`);
				break;
			}
			case "boxShadow": {
				const shadow = convertBoxShadowString(String(value));
				if (shadow) lines.push(`${indent}${shadow}`);
				break;
			}
			case "backdropFilter": {
				const blurMatch = String(value).trim().match(/blur\(\s*([\d.]+)\s*px\s*\)/i);
				if (blurMatch) lines.push(`${indent}.backdropBlur(${blurMatch[1]})`);
				break;
			}
			default:
				if (BORDER_SIDE_SHORTHANDS.some((k) => mergedStyles[k] !== void 0)) {
					const borderResult = mergeShorthandBorderSides(mergedStyles);
					if (borderResult) lines.push(`${indent}${borderResult}`);
				}
				break;
		}
	}
	return lines;
}
function getV2AlignModifiers(styles, componentName, indent) {
	if (!styles) return [];
	const modifiers = [];
	const alignItems = styles.alignItems;
	const justifyContent = styles.justifyContent;
	const justifyMap = {
		Start: "FlexAlign.Start",
		End: "FlexAlign.End",
		Center: "FlexAlign.Center",
		SpaceBetween: "FlexAlign.SpaceBetween",
		"Space-between": "FlexAlign.SpaceBetween",
		SpaceAround: "FlexAlign.SpaceAround",
		"Space-around": "FlexAlign.SpaceAround",
		SpaceEvenly: "FlexAlign.SpaceEvenly",
		"Space-evenly": "FlexAlign.SpaceEvenly"
	};
	if (justifyContent && justifyMap[justifyContent]) modifiers.push(`${indent}.justifyContent(${justifyMap[justifyContent]})`);
	if (!NO_ALIGN_ITEMS_COMPONENTS.has(componentName)) {
		const isRow = componentName === "Row";
		const effectiveAlign = alignItems || "Start";
		const map = isRow ? ALIGN_ITEMS_MAP_ROW : ALIGN_ITEMS_MAP;
		if (map[effectiveAlign]) modifiers.push(`${indent}.alignItems(${map[effectiveAlign]})`);
	}
	return modifiers;
}
function getV2GridModifiers(styles, indent) {
	if (!styles) return [];
	const modifiers = [];
	if (styles.columnsTemplate) modifiers.push(`${indent}.columnsTemplate('${styles.columnsTemplate}')`);
	if (styles.rowsTemplate) modifiers.push(`${indent}.rowsTemplate('${styles.rowsTemplate}')`);
	if (styles.columnsGap !== void 0) modifiers.push(`${indent}.columnsGap(${styles.columnsGap})`);
	if (styles.rowsGap !== void 0) modifiers.push(`${indent}.rowsGap(${styles.rowsGap})`);
	return modifiers;
}
function getV2SpaceParam(styles) {
	if (!(styles == null ? void 0 : styles.space)) return "";
	return `{ space: ${styles.space} }`;
}
var importMap = /* @__PURE__ */ new Map();
var snippetSet = /* @__PURE__ */ new Set();
function parseImport(statement) {
	const match = statement.match(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/);
	if (!match) return null;
	return {
		names: match[1].split(",").map((s) => s.trim()).filter(Boolean),
		module: match[2]
	};
}
function addImport(statement) {
	const parsed = parseImport(statement);
	if (parsed) {
		if (!importMap.has(parsed.module)) importMap.set(parsed.module, /* @__PURE__ */ new Set());
		const nameSet = importMap.get(parsed.module);
		for (const name of parsed.names) nameSet.add(name);
	} else if (!importMap.has(statement)) importMap.set(statement, /* @__PURE__ */ new Set());
}
function getImports() {
	const result = [];
	for (const [key, nameSet] of importMap) if (nameSet.size > 0) {
		const names = [...nameSet].join(", ");
		result.push(`import { ${names} } from '${key}';`);
	} else result.push(key);
	return result;
}
function resetRegistry() {
	importMap.clear();
	snippetSet.clear();
}
var CHIP_LABEL_PROPS = /* @__PURE__ */ new Set([
	"text",
	"fontSize",
	"fontColor",
	"activatedFontColor",
	"fontFamily",
	"labelMargin",
	"localizedLabelMargin"
]);
function escapeStr$1(s) {
	return s.replace(/\\/g, "\\\\").replace(/\r\n/g, "\\n").replace(/\n/g, "\\n").replace(/\r/g, "\\n").replace(/\t/g, " ").replace(/"/g, "\\\"");
}
function generateChip(node, depth, _parentOffset, propIndent) {
	var _a;
	const indent = "  ".repeat(depth);
	const row = (_a = node.children) == null ? void 0 : _a[0];
	addImport("import { Chip, LengthMetrics } from '@kit.ArkUI';");
	const params = ["allowClose: false", "enabled: true"];
	params.unshift(`label: {
${propIndent}  text: "操作块"
${propIndent}}`);
	if ((row == null ? void 0 : row.componentName) === "Row" && row.styles) {
		const rowStyles = row.styles;
		if (rowStyles.width !== void 0 || rowStyles.height !== void 0) {
			const w = rowStyles.width ?? 0;
			const h = rowStyles.height ?? 0;
			params.push(`size: { width: ${w}, height: ${h} }`);
		}
		if (rowStyles.padding && typeof rowStyles.padding === "object") {
			const p = rowStyles.padding;
			params.push(`padding: { top: LengthMetrics.vp(${p.top ?? 0}), end: LengthMetrics.vp(${p.right ?? 0}), bottom: LengthMetrics.vp(${p.bottom ?? 0}), start: LengthMetrics.vp(${p.left ?? 0}) }`);
		}
		const directProps = [];
		const skipProps = /* @__PURE__ */ new Set([
			"width",
			"height",
			"padding",
			"overflow",
			"position",
			"left",
			"top"
		]);
		for (const [key, value] of Object.entries(rowStyles)) {
			if (skipProps.has(key)) continue;
			if (typeof value === "string") directProps.push(`${key}: "${value}"`);
			else if (typeof value === "number") directProps.push(`${key}: ${value}`);
			else if (typeof value === "boolean") directProps.push(`${key}: ${value}`);
		}
		params.push(...directProps);
	}
	if (row == null ? void 0 : row.children) {
		const textNode = row.children.find((c) => c.componentName === "Text");
		if (textNode) {
			const labelProps = [];
			if (textNode.content) labelProps.push(`text: "${escapeStr$1(textNode.content)}"`);
			const textStyles = textNode.styles ?? {};
			for (const prop of CHIP_LABEL_PROPS) {
				if (prop === "text") continue;
				if (textStyles[prop] !== void 0) {
					const value = textStyles[prop];
					if (typeof value === "string") labelProps.push(`${prop}: "${value}"`);
					else if (typeof value === "number") labelProps.push(`${prop}: ${value}`);
				}
			}
			if (labelProps.length > 0) {
				const defaultLabelIndex = params.findIndex((p) => p.startsWith("label: {"));
				const newLabel = `label: {
${propIndent}  ${labelProps.join(",\n" + propIndent + "  ")}
${propIndent}}`;
				if (defaultLabelIndex >= 0) params[defaultLabelIndex] = newLabel;
				else params.push(newLabel);
			}
		}
	}
	return `${indent}Chip({
${params.map((p) => `${propIndent}${p}`).join(",\n")}
${indent}})`;
}
function generateChipWithPosition(node, depth, parentOffset, propIndent) {
	var _a, _b;
	const code = generateChip(node, depth, parentOffset, propIndent);
	if (node.styles && node.styles.position === "absolute") {
		const indent = "  ".repeat(depth);
		const rawLeft = ((_a = node.styles) == null ? void 0 : _a.left) ?? 0;
		const rawTop = ((_b = node.styles) == null ? void 0 : _b.top) ?? 0;
		const left = rawLeft - ((parentOffset == null ? void 0 : parentOffset.left) ?? 0);
		const top = rawTop - ((parentOffset == null ? void 0 : parentOffset.top) ?? 0);
		return code + (left === 0 && top === 0 ? `
${indent}.position({ x: 0, y: 0 })` : `
${indent}.position({ x: ${left}, y: ${top} })`);
	}
	return code;
}
function generateText(node, depth, parentOffset, styles, buildStyleLines2, posSuffix2, escapeStr2) {
	var _a;
	const indent = "  ".repeat(depth);
	const propIndent = "  ".repeat(depth + 1);
	const needPos = (styles == null ? void 0 : styles.position) === "absolute";
	const text = node.content ?? "";
	const styleLines = buildStyleLines2(styles, "Text", propIndent, { hasPosition: needPos });
	return [`${indent}Text(${((_a = node.meta) == null ? void 0 : _a.isParamRef) === true ? text : `"${escapeStr2(text)}"`})`, ...styleLines].join("\n") + posSuffix2(node, indent, parentOffset);
}
function generateImage(node, depth, parentOffset, styles, buildStyleLines2, posSuffix2, v2ToArkUIResource2) {
	const indent = "  ".repeat(depth);
	const propIndent = "  ".repeat(depth + 1);
	const needPos = (styles == null ? void 0 : styles.position) === "absolute";
	const src = v2ToArkUIResource2(node.src ?? "");
	const styleLines = buildStyleLines2(styles, "Image", propIndent, {
		hasPosition: needPos,
		skipBackgroundImage: true,
		skipBackgroundColor: true
	});
	return [`${indent}Image(${src})`, ...styleLines].join("\n") + posSuffix2(node, indent, parentOffset);
}
function generateButton(node, depth, parentOffset, children, styles, buildStyleLines2, posSuffix2, v2ToArkUIResource2, getChildOffset2, generateV2Node2) {
	const indent = "  ".repeat(depth);
	const propIndent = "  ".repeat(depth + 1);
	const needPos = (styles == null ? void 0 : styles.position) === "absolute";
	const src = node.src ? v2ToArkUIResource2(node.src) : "";
	const styleLines = buildStyleLines2(styles, "Button", propIndent, { hasPosition: needPos });
	const bgColorLine = (styles == null ? void 0 : styles.backgroundColor) ? "" : `${propIndent}.backgroundColor(Color.Transparent)`;
	if (children.length > 0) {
		const childOffset = getChildOffset2(node);
		const childLines = children.map((c) => generateV2Node2(c, depth + 1, childOffset));
		return [
			`${indent}Button() {`,
			...childLines,
			`${indent}}`,
			bgColorLine,
			...styleLines
		].filter(Boolean).join("\n") + posSuffix2(node, indent, parentOffset);
	}
	if (src) return [
		`${indent}Button() {`,
		`${propIndent}Image(${src})`,
		`${indent}}`,
		bgColorLine,
		...styleLines
	].filter(Boolean).join("\n") + posSuffix2(node, indent, parentOffset);
	return [
		`${indent}Button()`,
		bgColorLine,
		...styleLines
	].filter(Boolean).join("\n") + posSuffix2(node, indent, parentOffset);
}
function generateSearch(node, depth, parentOffset, _children, styles, buildStyleLines2, posSuffix2, extractTextFromChildren2, escapeStr2) {
	const indent = "  ".repeat(depth);
	const styleLines = buildStyleLines2(styles, "Search", "  ".repeat(depth + 1), { hasPosition: (styles == null ? void 0 : styles.position) === "absolute" });
	const placeholder = extractTextFromChildren2(node) || node.content || "";
	return [`${indent}Search(${placeholder ? `{ placeholder: "${escapeStr2(placeholder)}" }` : ""})`, ...styleLines].join("\n") + posSuffix2(node, indent, parentOffset);
}
function generateSelect(node, depth, parentOffset, children, styles, buildStyleLines2, posSuffix2, extractTextFromChildren2, escapeStr2) {
	const indent = "  ".repeat(depth);
	const styleLines = buildStyleLines2(styles, "Select", "  ".repeat(depth + 1), { hasPosition: (styles == null ? void 0 : styles.position) === "absolute" });
	const options = children.map((c) => {
		const text = extractTextFromChildren2(c) || c.content || "";
		return text ? `{ value: "${escapeStr2(text)}" }` : null;
	}).filter((o) => o !== null);
	let selectParam = "";
	if (options.length > 0) selectParam = `[${options.join(", ")}]`;
	else selectParam = "[{ value: \"aaa\" }]";
	return [`${indent}Select(${selectParam})`, ...styleLines].join("\n") + posSuffix2(node, indent, parentOffset);
}
function generateRadio(node, depth, parentOffset, styles, buildStyleLines2, posSuffix2) {
	const indent = "  ".repeat(depth);
	const styleLines = buildStyleLines2(styles, "Radio", "  ".repeat(depth + 1), { hasPosition: (styles == null ? void 0 : styles.position) === "absolute" });
	return [`${indent}Radio({ value: '', group: '' })`, ...styleLines].join("\n") + posSuffix2(node, indent, parentOffset);
}
function generateToggle(node, depth, parentOffset, styles, buildStyleLines2, posSuffix2) {
	const indent = "  ".repeat(depth);
	const styleLines = buildStyleLines2(styles, "Toggle", "  ".repeat(depth + 1), {
		hasPosition: (styles == null ? void 0 : styles.position) === "absolute",
		skipBackgroundColor: true,
		skipBorderRadius: true
	});
	return [`${indent}Toggle({ type: ToggleType.Switch, isOn: true })`, ...styleLines].join("\n") + posSuffix2(node, indent, parentOffset);
}
function generateSlider(node, depth, parentOffset, styles, buildStyleLines2, posSuffix2) {
	const indent = "  ".repeat(depth);
	const propIndent = "  ".repeat(depth + 1);
	const styleLines = buildStyleLines2(styles, "Slider", propIndent, {
		hasPosition: (styles == null ? void 0 : styles.position) === "absolute",
		skipBackgroundColor: true,
		skipBorderRadius: true
	});
	return [
		`${indent}Slider({ style: SliderStyle.InSet, value: 50 })`,
		`${propIndent}.showTips(true)`,
		...styleLines
	].join("\n") + posSuffix2(node, indent, parentOffset);
}
var HDS_COMPONENTS = /* @__PURE__ */ new Set([
	"HdsListItem",
	"HdsListItemCard",
	"HdsActionBar",
	"HdsNavDestination",
	"HdsNavigation",
	"HdsSideBar",
	"HdsSideMenu",
	"HdsSnackBar",
	"HdsTabs",
	"HdsVisualComponent"
]);
function generateHds(node, componentName, depth, parentOffset, buildStyleLines2, getV2AlignModifiers2, posSuffix2, getChildOffset2, generateV2Node2) {
	const indent = "  ".repeat(depth);
	const propIndent = "  ".repeat(depth + 1);
	const styles = node.styles;
	const children = node.children ?? [];
	const styleLines = buildStyleLines2(styles, componentName, propIndent, { hasPosition: (styles == null ? void 0 : styles.position) === "absolute" });
	const alignModifiers = getV2AlignModifiers2(styles, componentName, propIndent);
	const childOffset = getChildOffset2(node);
	if (componentName === "HdsListItem") return generateHdsListItem(node, depth, styleLines, alignModifiers, generateV2Node2) + posSuffix2(node, indent, parentOffset);
	const childLines = children.map((c) => generateV2Node2(c, depth + 1, childOffset));
	if (childLines.length > 0) return [
		`${indent}${componentName}() {`,
		...childLines,
		`${indent}}`,
		...alignModifiers,
		...styleLines
	].join("\n") + posSuffix2(node, indent, parentOffset);
	return [
		`${indent}${componentName}()`,
		...alignModifiers,
		...styleLines
	].join("\n") + posSuffix2(node, indent, parentOffset);
}
function generateHdsListItem(node, depth, styleLines, alignModifiers, generateV2Node2) {
	const indent = "  ".repeat(depth);
	const propIndent = "  ".repeat(depth + 1);
	const childLines = (node.children ?? []).map((c) => generateV2Node2(c, depth + 2));
	return [
		`${indent}ListItem() {`,
		`${propIndent}Row() {`,
		...childLines,
		`${propIndent}}`,
		...alignModifiers.map((m) => `${propIndent}${m.replace(propIndent, "").trimStart()}`),
		...styleLines.map((s) => `${propIndent}${s.replace(propIndent, "").trimStart()}`),
		`${indent}}`
	].join("\n");
}
function generateScroll(node, depth, parentOffset, children, styles, buildStyleLines2, posSuffix2, getChildOffset2, generateV2Node2) {
	const indent = "  ".repeat(depth);
	const styleLines = buildStyleLines2(styles, "Scroll", "  ".repeat(depth + 1), { hasPosition: (styles == null ? void 0 : styles.position) === "absolute" });
	const childOffset = getChildOffset2(node);
	const childLines = children.map((c) => generateV2Node2(c, depth + 1, childOffset));
	return [
		`${indent}Scroll() {`,
		...childLines,
		`${indent}}`,
		...styleLines
	].join("\n") + posSuffix2(node, indent, parentOffset);
}
function generateList(node, depth, parentOffset, children, styles, buildStyleLines2, posSuffix2, getChildOffset2, generateV2Node2, isVirtualGroup2) {
	const indent = "  ".repeat(depth);
	const styleLines = buildStyleLines2(styles, "List", "  ".repeat(depth + 1), { hasPosition: (styles == null ? void 0 : styles.position) === "absolute" });
	const childOffset = getChildOffset2(node);
	const childLines = children.map((c) => generateListItemChild(c, depth + 1, childOffset, generateV2Node2, isVirtualGroup2));
	return [
		`${indent}List(${getV2SpaceParam(styles)}) {`,
		...childLines,
		`${indent}}`,
		...styleLines
	].join("\n") + posSuffix2(node, indent, parentOffset);
}
function generateListItemChild(child, depth, parentOffset, generateV2Node2, isVirtualGroup2) {
	var _a;
	const indent = "  ".repeat(depth);
	const innerIndent = "  ".repeat(depth + 1);
	if (child.componentName === "ListItem") return generateV2Node2(child, depth, parentOffset);
	const childCode = generateV2Node2(child, depth + 2, parentOffset);
	if (isVirtualGroup2(child) && (((_a = child.children) == null ? void 0 : _a.length) ?? 0) > 1) return `${indent}ListItem() {
${innerIndent}Column() {
${childCode}
${innerIndent}}
${indent}}`;
	return `${indent}ListItem() {
${childCode}
${indent}}`;
}
function generateGrid(node, depth, parentOffset, children, styles, buildStyleLines2, posSuffix2, getChildOffset2, generateV2Node2, isVirtualGroup2) {
	const indent = "  ".repeat(depth);
	const propIndent = "  ".repeat(depth + 1);
	const styleLines = buildStyleLines2(styles, "Grid", propIndent, { hasPosition: (styles == null ? void 0 : styles.position) === "absolute" });
	const gridModifiers = getV2GridModifiers(styles, propIndent);
	const childOffset = getChildOffset2(node);
	const childLines = children.map((c) => generateGridItemChild(c, depth + 1, childOffset, generateV2Node2, isVirtualGroup2));
	return [
		`${indent}Grid() {`,
		...childLines,
		`${indent}}`,
		...gridModifiers,
		...styleLines
	].join("\n") + posSuffix2(node, indent, parentOffset);
}
function generateGridItemChild(child, depth, parentOffset, generateV2Node2, isVirtualGroup2) {
	var _a;
	const indent = "  ".repeat(depth);
	const innerIndent = "  ".repeat(depth + 1);
	if (child.componentName === "GridItem") {
		const gridItemChildren = child.children ?? [];
		if (gridItemChildren.length <= 1) return generateV2Node2(child, depth, parentOffset);
		return `${indent}GridItem() {
${innerIndent}Column() {
${gridItemChildren.map((c) => generateV2Node2(c, depth + 3, void 0)).join("\n")}
${innerIndent}}
${indent}}`;
	}
	const childCode = generateV2Node2(child, depth + 2, parentOffset);
	if (isVirtualGroup2(child) && (((_a = child.children) == null ? void 0 : _a.length) ?? 0) > 1) return `${indent}GridItem() {
${innerIndent}Column() {
${childCode}
${innerIndent}}
${indent}}`;
	return `${indent}GridItem() {
${childCode}
${indent}}`;
}
function generateCheckbox(node, depth, parentOffset, styles, buildStyleLines2, posSuffix2) {
	const indent = "  ".repeat(depth);
	const propIndent = "  ".repeat(depth + 1);
	const styleLines = buildStyleLines2(styles, "Checkbox", propIndent, { hasPosition: (styles == null ? void 0 : styles.position) === "absolute" });
	return [
		`${indent}Checkbox()`,
		`${propIndent}.select(true)`,
		`${propIndent}.selectedColor("#0c5af7")`,
		`${propIndent}.shape(CheckBoxShape.ROUNDED_SQUARE)`,
		...styleLines
	].join("\n") + posSuffix2(node, indent, parentOffset);
}
function generateCheckboxGroup(node, depth, parentOffset, children, styles, buildStyleLines2, posSuffix2, extractTextFromChildren2, escapeStr2) {
	const indent = "  ".repeat(depth);
	const propIndent = "  ".repeat(depth + 1);
	const itemIndent = "  ".repeat(depth + 2);
	const styleLines = buildStyleLines2(styles, "CheckboxGroup", propIndent, { hasPosition: (styles == null ? void 0 : styles.position) === "absolute" });
	const lines = [];
	lines.push(`${indent}Column() {`);
	lines.push(`${propIndent}Flex({ justifyContent: FlexAlign.Start, alignItems: ItemAlign.Center }) {`);
	lines.push(`${itemIndent}CheckboxGroup({ group: 'checkboxGroup' })`);
	lines.push(`${itemIndent}  .checkboxShape(CheckBoxShape.ROUNDED_SQUARE)`);
	lines.push(`${itemIndent}  .selectedColor('#0c5af7')`);
	lines.push(`${itemIndent}  .onChange((itemName: CheckboxGroupResult) => {`);
	lines.push(`${itemIndent}    console.info("checkbox group content" + JSON.stringify(itemName))`);
	lines.push(`${itemIndent}  })`);
	lines.push(`${itemIndent}Text('Select All').fontSize(14).lineHeight(20).fontColor('#182431').fontWeight(500)`);
	lines.push(`${propIndent}}`);
	children.forEach((child, index) => {
		const escapedLabel = escapeStr2(extractTextFromChildren2(child) || `Checkbox${index + 1}`);
		lines.push(``);
		lines.push(`${propIndent}Flex({ justifyContent: FlexAlign.Start, alignItems: ItemAlign.Center }) {`);
		lines.push(`${itemIndent}Checkbox({ name: 'checkbox${index + 1}', group: 'checkboxGroup' })`);
		lines.push(`${itemIndent}  .selectedColor('#0c5af7')`);
		lines.push(`${itemIndent}  .shape(CheckBoxShape.ROUNDED_SQUARE)`);
		lines.push(`${itemIndent}  .onChange((value: boolean) => {`);
		lines.push(`${itemIndent}    console.info('Checkbox${index + 1} change is' + value)`);
		lines.push(`${itemIndent}  })`);
		lines.push(`${itemIndent}Text('${escapedLabel}').fontSize(14).lineHeight(20).fontColor('#182431').fontWeight(500)`);
		lines.push(`${propIndent}}.margin({ left: 36 })`);
	});
	lines.push(`${indent}}`);
	lines.push(...styleLines);
	return lines.join("\n") + posSuffix2(node, indent, parentOffset);
}
function generateRating(node, depth, parentOffset, styles, buildStyleLines2, posSuffix2) {
	const indent = "  ".repeat(depth);
	const propIndent = "  ".repeat(depth + 1);
	const styleLines = buildStyleLines2(styles, "Rating", propIndent, { hasPosition: (styles == null ? void 0 : styles.position) === "absolute" });
	return [
		`${indent}Rating({ rating: 5, indicator: false })`,
		`${propIndent}.stars(5)`,
		`${propIndent}.stepSize(0.5)`,
		...styleLines
	].join("\n") + posSuffix2(node, indent, parentOffset);
}
function generateCounter(node, depth, parentOffset, styles, buildStyleLines2, posSuffix2) {
	const indent = "  ".repeat(depth);
	const propIndent = "  ".repeat(depth + 1);
	const styleLines = buildStyleLines2(styles, "Counter", propIndent, { hasPosition: (styles == null ? void 0 : styles.position) === "absolute" });
	return [
		`${indent}Counter() {`,
		`${propIndent}Text("1")`,
		`${indent}}`,
		...styleLines
	].join("\n") + posSuffix2(node, indent, parentOffset);
}
function generateTextInput(node, depth, parentOffset, styles, buildStyleLines2, posSuffix2) {
	const indent = "  ".repeat(depth);
	const styleLines = buildStyleLines2(styles, "TextInput", "  ".repeat(depth + 1), { hasPosition: (styles == null ? void 0 : styles.position) === "absolute" });
	return [`${indent}TextInput({ text: "", placeholder: 'input your word...' })`, ...styleLines].join("\n") + posSuffix2(node, indent, parentOffset);
}
function generateProgress(node, depth, parentOffset, styles, buildStyleLines2, posSuffix2) {
	const indent = "  ".repeat(depth);
	const propIndent = "  ".repeat(depth + 1);
	const styleLines = buildStyleLines2(styles, "Progress", propIndent, { hasPosition: (styles == null ? void 0 : styles.position) === "absolute" });
	return [
		`${indent}Progress({ value: 10, type: ProgressType.Linear })`,
		`${propIndent}.style({ strokeWidth: 10, enableSmoothEffect: true })`,
		...styleLines
	].join("\n") + posSuffix2(node, indent, parentOffset);
}
function generateQRCode(node, depth, parentOffset, styles, buildStyleLines2, posSuffix2) {
	const indent = "  ".repeat(depth);
	const styleLines = buildStyleLines2(styles, "QRCode", "  ".repeat(depth + 1), { hasPosition: (styles == null ? void 0 : styles.position) === "absolute" });
	return [`${indent}QRCode("hello world")`, ...styleLines].join("\n") + posSuffix2(node, indent, parentOffset);
}
function generateSubHeaderV2(node, depth, parentOffset, styles, buildStyleLines2, posSuffix2, v2ToArkUIResource2, extractTextFromChildren2) {
	addImport("import { SubHeaderV2, SubHeaderV2Title, TextModifier, SubHeaderV2OperationType } from '@kit.ArkUI';");
	const indent = "  ".repeat(depth);
	const propIndent = "  ".repeat(depth + 1);
	const styleLines = buildStyleLines2(styles, "SubHeaderV2", propIndent, { hasPosition: (styles == null ? void 0 : styles.position) === "absolute" });
	const children = node.children ?? [];
	let iconStr = "icon: ''";
	for (const child of children) if (child.componentName === "Image" && child.src) {
		iconStr = `icon: ${v2ToArkUIResource2(child.src)}`;
		break;
	}
	let primaryTitle = "";
	const modifierParts = [];
	for (const child of children) if (child.componentName === "Text") {
		const text = extractTextFromChildren2(child) || child.content || "";
		if (text) primaryTitle = text;
		const textStyles = child.styles;
		if (textStyles) {
			if (textStyles.fontColor) modifierParts.push(`.fontColor("${textStyles.fontColor}")`);
			if (textStyles.fontWeight !== void 0) modifierParts.push(`.fontWeight(${textStyles.fontWeight})`);
			if (textStyles.fontSize !== void 0) modifierParts.push(`.fontSize(${textStyles.fontSize})`);
		}
		break;
	}
	const titleModifierStr = modifierParts.length > 0 ? `new TextModifier()${modifierParts.join("")}` : "";
	return [
		`${indent}SubHeaderV2({`,
		`${propIndent}${iconStr},`,
		`${propIndent}title: new SubHeaderV2Title({`,
		`${propIndent}  primaryTitle: "${primaryTitle}",`,
		`${propIndent}  primaryTitleModifier: ${titleModifierStr || "new TextModifier()"}`,
		`${propIndent}}),`,
		`${propIndent}operationType: SubHeaderV2OperationType.BUTTON,`,
		`${propIndent}operationItems: []`,
		`${indent}})`,
		...styleLines
	].join("\n") + posSuffix2(node, indent, parentOffset);
}
function generateCalendarPicker(node, depth, parentOffset, styles, buildStyleLines2, posSuffix2) {
	const indent = "  ".repeat(depth);
	const propIndent = "  ".repeat(depth + 1);
	const styleLines = buildStyleLines2(styles, "CalendarPicker", propIndent, { hasPosition: (styles == null ? void 0 : styles.position) === "absolute" });
	return [
		`${indent}CalendarPicker({ hintRadius: 10, selected: new Date() })`,
		`${propIndent}.edgeAlign(CalendarAlign.END)`,
		...styleLines
	].join("\n") + posSuffix2(node, indent, parentOffset);
}
function generateSwiper(node, depth, parentOffset, styles, buildStyleLines2, posSuffix2) {
	addImport(`class MyDataSource implements IDataSource {
  private list: number[] = [];

  constructor(list: number[]) {
    this.list = list;
  }

  totalCount(): number {
    return this.list.length;
  }

  getData(index: number): number {
    return this.list[index];
  }

  registerDataChangeListener(listener: DataChangeListener): void {
  }

  unregisterDataChangeListener() {
  }
}`);
	const indent = "  ".repeat(depth);
	const propIndent = "  ".repeat(depth + 1);
	const itemIndent = "  ".repeat(depth + 2);
	const styleLines = buildStyleLines2(styles, "Swiper", propIndent, { hasPosition: (styles == null ? void 0 : styles.position) === "absolute" });
	return [
		`${indent}Swiper(new SwiperController()) {`,
		`${propIndent}LazyForEach(new MyDataSource([1, 2, 3]), (item: string) => {`,
		`${itemIndent}Text(item.toString())`,
		`${itemIndent}  .width('90%')`,
		`${itemIndent}  .height(160)`,
		`${itemIndent}  .backgroundColor(0xAFEEEE)`,
		`${itemIndent}  .textAlign(TextAlign.Center)`,
		`${itemIndent}  .fontSize(30)`,
		`${propIndent}}, (item: string) => item)`,
		`${indent}}`,
		`${propIndent}.cachedCount(2)`,
		`${propIndent}.index(1)`,
		`${propIndent}.autoPlay(true)`,
		`${propIndent}.interval(4000)`,
		`${propIndent}.loop(true)`,
		`${propIndent}.indicatorInteractive(true)`,
		`${propIndent}.duration(1000)`,
		`${propIndent}.itemSpace(5)`,
		`${propIndent}.prevMargin(35)`,
		`${propIndent}.nextMargin(35)`,
		`${propIndent}.indicator(`,
		`${propIndent}  new DotIndicator()`,
		`${propIndent}    .itemWidth(15)`,
		`${propIndent}    .itemHeight(15)`,
		`${propIndent}    .selectedItemWidth(15)`,
		`${propIndent}    .selectedItemHeight(15)`,
		`${propIndent}    .color(Color.Gray)`,
		`${propIndent}    .selectedColor(Color.Blue))`,
		`${propIndent}.displayArrow({`,
		`${propIndent}  showBackground: true,`,
		`${propIndent}  isSidebarMiddle: true,`,
		`${propIndent}  backgroundSize: 24,`,
		`${propIndent}  backgroundColor: Color.White,`,
		`${propIndent}  arrowSize: 18,`,
		`${propIndent}  arrowColor: Color.Blue`,
		`${propIndent}}, false)`,
		`${propIndent}.curve(Curve.Linear)`,
		...styleLines
	].join("\n") + posSuffix2(node, indent, parentOffset);
}
var componentRegistry = [
	{
		match: (name) => name === "Chips" || name === "Chip",
		generate: (node, depth, parentOffset, _ctx) => {
			return generateChipWithPosition(node, depth, parentOffset, "  ".repeat(depth + 1));
		}
	},
	{
		match: (name) => name === "Text",
		generate: (node, depth, parentOffset, ctx) => {
			return generateText(node, depth, parentOffset, node.styles, ctx.buildStyleLines, ctx.posSuffix, ctx.escapeStr);
		}
	},
	{
		match: (name) => name === "Image",
		generate: (node, depth, parentOffset, ctx) => {
			return generateImage(node, depth, parentOffset, node.styles, ctx.buildStyleLines, ctx.posSuffix, ctx.v2ToArkUIResource);
		}
	},
	{
		match: (name) => name === "Button",
		generate: (node, depth, parentOffset, ctx) => {
			return generateButton(node, depth, parentOffset, node.children ?? [], node.styles, ctx.buildStyleLines, ctx.posSuffix, ctx.v2ToArkUIResource, ctx.getChildOffset, ctx.generateV2Node);
		}
	},
	{
		match: (name) => name === "Search",
		generate: (node, depth, parentOffset, ctx) => {
			return generateSearch(node, depth, parentOffset, node.children ?? [], node.styles, ctx.buildStyleLines, ctx.posSuffix, ctx.extractTextFromChildren, ctx.escapeStr);
		}
	},
	{
		match: (name) => name === "Select",
		generate: (node, depth, parentOffset, ctx) => {
			return generateSelect(node, depth, parentOffset, node.children ?? [], node.styles, ctx.buildStyleLines, ctx.posSuffix, ctx.extractTextFromChildren, ctx.escapeStr);
		}
	},
	{
		match: (name) => name === "Radio",
		generate: (node, depth, parentOffset, ctx) => {
			return generateRadio(node, depth, parentOffset, node.styles, ctx.buildStyleLines, ctx.posSuffix);
		}
	},
	{
		match: (name) => name === "Checkbox",
		generate: (node, depth, parentOffset, ctx) => {
			return generateCheckbox(node, depth, parentOffset, node.styles, ctx.buildStyleLines, ctx.posSuffix);
		}
	},
	{
		match: (name) => name === "CheckboxGroup",
		generate: (node, depth, parentOffset, ctx) => {
			return generateCheckboxGroup(node, depth, parentOffset, node.children ?? [], node.styles, ctx.buildStyleLines, ctx.posSuffix, ctx.extractTextFromChildren, ctx.escapeStr);
		}
	},
	{
		match: (name) => name === "Rating",
		generate: (node, depth, parentOffset, ctx) => {
			return generateRating(node, depth, parentOffset, node.styles, ctx.buildStyleLines, ctx.posSuffix);
		}
	},
	{
		match: (name) => name === "Counter",
		generate: (node, depth, parentOffset, ctx) => {
			return generateCounter(node, depth, parentOffset, node.styles, ctx.buildStyleLines, ctx.posSuffix);
		}
	},
	{
		match: (name) => name === "TextInput",
		generate: (node, depth, parentOffset, ctx) => {
			return generateTextInput(node, depth, parentOffset, node.styles, ctx.buildStyleLines, ctx.posSuffix);
		}
	},
	{
		match: (name) => name === "Progress",
		generate: (node, depth, parentOffset, ctx) => {
			return generateProgress(node, depth, parentOffset, node.styles, ctx.buildStyleLines, ctx.posSuffix);
		}
	},
	{
		match: (name) => name === "QRCode",
		generate: (node, depth, parentOffset, ctx) => {
			return generateQRCode(node, depth, parentOffset, node.styles, ctx.buildStyleLines, ctx.posSuffix);
		}
	},
	{
		match: (name) => name === "SubHeader",
		generate: (node, depth, parentOffset, ctx) => {
			return generateSubHeaderV2(node, depth, parentOffset, node.styles, ctx.buildStyleLines, ctx.posSuffix, ctx.v2ToArkUIResource, ctx.extractTextFromChildren);
		}
	},
	{
		match: (name) => name === "CalendarPicker" || name === "Calendar",
		generate: (node, depth, parentOffset, ctx) => {
			return generateCalendarPicker(node, depth, parentOffset, node.styles, ctx.buildStyleLines, ctx.posSuffix);
		}
	},
	{
		match: (name) => name === "Swiper",
		generate: (node, depth, parentOffset, ctx) => {
			return generateSwiper(node, depth, parentOffset, node.styles, ctx.buildStyleLines, ctx.posSuffix);
		}
	},
	{
		match: (name) => name === "Toggle",
		generate: (node, depth, parentOffset, ctx) => {
			return generateToggle(node, depth, parentOffset, node.styles, ctx.buildStyleLines, ctx.posSuffix);
		}
	},
	{
		match: (name) => name === "Slider",
		generate: (node, depth, parentOffset, ctx) => {
			return generateSlider(node, depth, parentOffset, node.styles, ctx.buildStyleLines, ctx.posSuffix);
		}
	},
	{
		match: (name) => HDS_COMPONENTS.has(name),
		generate: (node, depth, parentOffset, ctx) => {
			return generateHds(node, node.componentName, depth, parentOffset, ctx.buildStyleLines, ctx.getV2AlignModifiers, ctx.posSuffix, ctx.getChildOffset, ctx.generateV2Node);
		}
	},
	{
		match: (name) => name === "Scroll",
		generate: (node, depth, parentOffset, ctx) => {
			return generateScroll(node, depth, parentOffset, node.children ?? [], node.styles, ctx.buildStyleLines, ctx.posSuffix, ctx.getChildOffset, ctx.generateV2Node);
		}
	},
	{
		match: (name) => name === "List",
		generate: (node, depth, parentOffset, ctx) => {
			return generateList(node, depth, parentOffset, node.children ?? [], node.styles, ctx.buildStyleLines, ctx.posSuffix, ctx.getChildOffset, ctx.generateV2Node, ctx.isVirtualGroup);
		}
	},
	{
		match: (name) => name === "Grid",
		generate: (node, depth, parentOffset, ctx) => {
			return generateGrid(node, depth, parentOffset, node.children ?? [], node.styles, ctx.buildStyleLines, ctx.posSuffix, ctx.getChildOffset, ctx.generateV2Node, ctx.isVirtualGroup);
		}
	}
];
function findComponentGenerator(componentName) {
	for (const entry of componentRegistry) if (entry.match(componentName)) return entry.generate;
	return null;
}
function hasAbsolute(styles) {
	return (styles == null ? void 0 : styles.position) === "absolute";
}
function posSuffix(node, indent, parentOffset) {
	var _a, _b;
	if (!hasAbsolute(node.styles)) return "";
	const rawLeft = (_a = node.styles) == null ? void 0 : _a.left;
	const rawTop = (_b = node.styles) == null ? void 0 : _b.top;
	const offsetLeft = (parentOffset == null ? void 0 : parentOffset.left) ?? 0;
	const offsetTop = (parentOffset == null ? void 0 : parentOffset.top) ?? 0;
	const leftNum = typeof rawLeft === "number" ? rawLeft : null;
	const topNum = typeof rawTop === "number" ? rawTop : null;
	let compLeft = leftNum;
	let compTop = topNum;
	const isPageAbsolute = parentOffset === void 0 || parentOffset.left === 0 && parentOffset.top === 0;
	if (leftNum !== null && topNum !== null && isPageAbsolute) {
		const compensated = compensatePositionV2({
			x: leftNum,
			y: topNum
		});
		if (compensated) {
			compLeft = compensated.x;
			compTop = compensated.y;
		}
	}
	let xExpr;
	if (compLeft !== null) xExpr = String(compLeft - offsetLeft);
	else xExpr = String(rawLeft);
	let yExpr;
	if (compTop !== null) yExpr = String(compTop - offsetTop);
	else yExpr = String(rawTop);
	return `
${indent}.position({ x: ${xExpr}, y: ${yExpr} })`;
}
function getChildOffset(node) {
	var _a;
	const componentName = node.componentName;
	const styles = node.styles;
	if (componentName === "Stack" || hasAbsolute(styles)) {
		if ((styles == null ? void 0 : styles.left) !== void 0 || (styles == null ? void 0 : styles.top) !== void 0) return {
			left: (styles == null ? void 0 : styles.left) ?? 0,
			top: (styles == null ? void 0 : styles.top) ?? 0
		};
		if (((_a = node.meta) == null ? void 0 : _a.bbox) && node.meta.bbox.length >= 2) return {
			left: node.meta.bbox[0],
			top: node.meta.bbox[1]
		};
		return {
			left: 0,
			top: 0
		};
	}
}
function isVirtualGroup(node) {
	var _a;
	return ((_a = node.meta) == null ? void 0 : _a.octoType) === "VIRTUAL_GROUP";
}
function escapeStr(s) {
	return s.replace(/\\/g, "\\\\").replace(/\r\n/g, "\\n").replace(/\n/g, "\\n").replace(/\r/g, "\\n").replace(/\t/g, " ").replace(/"/g, "\\\"");
}
function v2ToArkUIResource(src) {
	if (!src) return "\"\"";
	if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(src)) return src;
	if (src.startsWith("http://") || src.startsWith("https://")) return `"${src}"`;
	const name = src.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").replace(/-/g, "_");
	return name ? `$r('app.media.${name}')` : "\"\"";
}
function extractTextFromChildren(node) {
	const children = node.children ?? [];
	for (const child of children) if (child.componentName === "Text" && child.content) return child.content;
	return "";
}
function buildStyleLines(styles, componentName, indent, styleOptions) {
	return v2StylesToArkUI(styles, componentName, indent, styleOptions);
}
var nodeToBuilderMap = /* @__PURE__ */ new Map();
var skipNodeSet = /* @__PURE__ */ new Set();
var containerParametricMap = /* @__PURE__ */ new Map();
function setNodeToBuilderMapping(mapping, skipIds = []) {
	nodeToBuilderMap.clear();
	for (const [nodeId, builderName] of Object.entries(mapping)) nodeToBuilderMap.set(nodeId, builderName);
	skipNodeSet.clear();
	for (const id of skipIds) skipNodeSet.add(id);
}
function setContainerParametricMapping(mapping) {
	containerParametricMap.clear();
	for (const [containerId, calls] of Object.entries(mapping)) containerParametricMap.set(containerId, calls);
}
function clearNodeToBuilderMapping() {
	nodeToBuilderMap.clear();
	skipNodeSet.clear();
	containerParametricMap.clear();
}
function getNodeId(node) {
	var _a;
	return ((_a = node.meta) == null ? void 0 : _a.octoId) ?? `${node.componentName}_${Object.keys(node.styles ?? {}).join("_")}`;
}
function generateV2Node(node, depth, parentOffset) {
	var _a;
	const indent = "  ".repeat(depth);
	if (isVirtualGroup(node)) return (node.children ?? []).map((c) => generateV2Node(c, depth, parentOffset)).join("\n");
	const componentName = resolveComponentName(node);
	const nodeId = getNodeId(node);
	if (nodeId && skipNodeSet.has(nodeId)) return "";
	if (shouldSkipNodeV2(node)) return "";
	const mappedCall = nodeToBuilderMap.get(nodeId);
	if (mappedCall) {
		if (mappedCall.includes("(")) return `${indent}this.${mappedCall}`;
		return `${indent}this.${mappedCall}()`;
	}
	let nodeForGen = node;
	const heightReduce = getContainerHeightReduce(nodeId);
	if (heightReduce > 0 && ((_a = node.styles) == null ? void 0 : _a.height) !== void 0) {
		const rawHeight = node.styles.height;
		const originalHeight = typeof rawHeight === "number" ? rawHeight : parseFloat(String(rawHeight));
		if (!isNaN(originalHeight) && !(typeof rawHeight === "string" && rawHeight.includes("%"))) nodeForGen = {
			...node,
			styles: {
				...node.styles,
				height: Math.max(0, originalHeight - heightReduce)
			}
		};
	}
	const externalGenerator = findComponentGenerator(componentName);
	if (externalGenerator) return externalGenerator(nodeForGen, depth, parentOffset, {
		posSuffix,
		buildStyleLines,
		generateV2Node,
		getChildOffset,
		escapeStr,
		v2ToArkUIResource,
		extractTextFromChildren,
		hasAbsolute,
		getV2AlignModifiers,
		isVirtualGroup
	});
	return generateContainerNode(nodeForGen, componentName, depth, parentOffset);
}
function resolveComponentName(node) {
	var _a, _b;
	const supType = (_b = (_a = node.meta) == null ? void 0 : _a.mergedFrom) == null ? void 0 : _b.supType;
	if (supType) {
		if (supType.toLowerCase() === "hdslistitem") return "HdsListItem";
		if (supType.toLowerCase() === "scroll") return "Scroll";
	}
	return node.componentName;
}
function generateContainerNode(node, componentName, depth, parentOffset) {
	const indent = "  ".repeat(depth);
	const propIndent = "  ".repeat(depth + 1);
	const styles = node.styles;
	const children = node.children ?? [];
	if (node.content && children.length === 0) {
		const text = node.content;
		const styleLines2 = buildStyleLines(styles, "Text", propIndent, { hasPosition: false });
		return [`${indent}Text("${escapeStr(text)}")`, ...styleLines2].join("\n") + posSuffix(node, indent, parentOffset);
	}
	const styleLines = buildStyleLines(styles, componentName, propIndent, { hasPosition: hasAbsolute(styles) });
	const alignModifiers = getV2AlignModifiers(styles, componentName, propIndent);
	const containerId = getNodeId(node);
	const parametricCalls = containerParametricMap.get(containerId);
	if (parametricCalls && parametricCalls.length > 0) {
		const spaceParam2 = getV2SpaceParam(styles);
		const callLines = parametricCalls.map((call) => `  ${propIndent}this.${call}`);
		return [
			`${indent}${componentName}(${spaceParam2}) {`,
			...callLines,
			`${indent}}`,
			...alignModifiers,
			...styleLines
		].join("\n") + posSuffix(node, indent, parentOffset);
	}
	const spaceParam = getV2SpaceParam(styles);
	const childOffset = getChildOffset(node);
	const childLines = children.map((c) => {
		const childId = getNodeId(c);
		if (childId && skipNodeSet.has(childId)) return null;
		const childBuilderName = nodeToBuilderMap.get(childId);
		if (childBuilderName) {
			if (childBuilderName.includes("(")) return `  ${propIndent}this.${childBuilderName}`;
			return `  ${propIndent}this.${childBuilderName}()`;
		}
		return generateV2Node(c, depth + 1, childOffset);
	}).filter((line) => line !== null && line !== "");
	if (childLines.length > 0) return [
		`${indent}${componentName}(${spaceParam}) {`,
		...childLines,
		`${indent}}`,
		...alignModifiers,
		...styleLines
	].join("\n") + posSuffix(node, indent, parentOffset);
	return [
		`${indent}${componentName}(${spaceParam})`,
		...alignModifiers,
		...styleLines
	].join("\n") + posSuffix(node, indent, parentOffset);
}
function recognizeRegions(rootNode, pageSize, _options = {}) {
	const children = rootNode.children ?? [];
	const rootStyles = rootNode.styles ?? {};
	const rootNodeStyles = {
		backgroundColor: rootStyles.backgroundColor,
		backgroundImage: rootStyles.backgroundImage,
		backgroundSize: rootStyles.backgroundSize,
		alignItems: rootStyles.alignItems,
		justifyContent: rootStyles.justifyContent,
		overflow: rootStyles.overflow
	};
	const rootComponentName = rootNode.componentName;
	const indexedNodes = children.map((node, index) => createIndexedNode(node, index, pageSize));
	let backgroundNode = null;
	const nonBgIndexedNodes = [];
	for (const indexed of indexedNodes) if (indexed.isFullScreen && !backgroundNode) backgroundNode = indexed.node;
	else nonBgIndexedNodes.push(indexed);
	const regions = createRegionsFromChildren(nonBgIndexedNodes);
	regions.forEach((region) => {
		region.type = detectRegionType(region, pageSize);
	});
	const extractedBuilders = [];
	const nodeToBuilderMapping = {};
	if (backgroundNode) {
		const bgNodeId = getNodeIdFromNode(backgroundNode);
		if (bgNodeId) nodeToBuilderMapping[bgNodeId] = "BackgroundLayer";
	}
	for (const region of regions) if (region.nodes.length >= 1) {
		const nodeId = getNodeIdFromNode(region.nodes[0]);
		if (nodeId) nodeToBuilderMapping[nodeId] = region.id;
	}
	return {
		pageSize,
		rootNodeStyles,
		rootComponentName,
		backgroundNode,
		rootRegions: regions,
		extractedBuilders,
		originalRootNode: rootNode,
		nodeToBuilderMapping,
		skipNodeIds: [],
		containerToPattern: {},
		containerParametricCalls: {}
	};
}
function createIndexedNode(node, index, pageSize) {
	const styles = node.styles ?? {};
	const bbox = (node.meta ?? {}).bbox ?? [
		0,
		0,
		100,
		100
	];
	const left = typeof styles.left === "number" ? styles.left : typeof bbox[0] === "number" ? bbox[0] : 0;
	const top = typeof styles.top === "number" ? styles.top : typeof bbox[1] === "number" ? bbox[1] : 0;
	const width = typeof styles.width === "number" ? styles.width : typeof (bbox[2] - bbox[0]) === "number" ? bbox[2] - bbox[0] : 100;
	const height = typeof styles.height === "number" ? styles.height : typeof (bbox[3] - bbox[1]) === "number" ? bbox[3] - bbox[1] : 100;
	const bottom = top + height;
	return {
		node,
		index,
		yTop: top,
		yBottom: bottom,
		width,
		height,
		xLeft: left,
		xRight: left + width,
		isFullScreen: node.componentName === "Image" && styles.position === "absolute" && width >= pageSize.width - 50 && height >= pageSize.height - 50,
		isBottomEdge: styles.position === "absolute" && bottom >= pageSize.height - 50
	};
}
function createRegionsFromChildren(nodes, _pageSize) {
	return nodes.map((indexedNode, index) => ({
		id: `Region_${index}`,
		displayName: `区域 ${index}`,
		type: "content",
		yRange: [indexedNode.yTop, indexedNode.yBottom],
		nodes: [indexedNode.node],
		subRegions: [],
		patterns: [],
		isExtracted: false
	}));
}
function detectRegionType(region, pageSize) {
	var _a, _b;
	const { nodes, yRange } = region;
	const [yTop, yBottom] = yRange;
	if (yTop < 50 && nodes.length > 0 && nodes[0].componentName !== "Image") {
		if (nodes.some((n) => {
			if (n.componentName === "Text" && n.content) {
				const content = n.content.toString();
				return /^\d{1,2}:\d{2}$/.test(content);
			}
			return false;
		}) || nodes.length <= 3) return "topBar";
	}
	if (yBottom >= pageSize.height - 50) {
		if (nodes.length === 1 && nodes[0].componentName === "Image") return "gestureBar";
		return "bottomBar";
	}
	if (nodes.length === 1 && nodes[0].componentName === "Image") {
		const imgNode = nodes[0];
		const imgWidth = typeof ((_a = imgNode.styles) == null ? void 0 : _a.width) === "number" ? imgNode.styles.width : 0;
		const imgHeight = typeof ((_b = imgNode.styles) == null ? void 0 : _b.height) === "number" ? imgNode.styles.height : 0;
		if (imgWidth < 100 && imgHeight < 30) return "indicator";
	}
	if (nodes.some((n) => n.componentName === "Column" || n.componentName === "Row")) {
		if (detectAppIconPattern(nodes)) return "appGrid";
	}
	if (yBottom - yTop > 100) return "card";
	return "content";
}
function detectAppIconPattern(nodes) {
	var _a, _b;
	for (const node of nodes) if (node.children && node.children.length >= 3) {
		const columns = node.children.filter((c) => c.componentName === "Column");
		if (columns.length >= 3) {
			const firstColumn = columns[0];
			if (firstColumn.children) {
				const hasImage = firstColumn.children.some((c) => c.componentName === "Image");
				const hasText = firstColumn.children.some((c) => c.componentName === "Text");
				if (hasImage && hasText) return true;
			}
		}
		const images = node.children.filter((c) => c.componentName === "Image");
		if (images.length >= 3) {
			const firstImg = images[0];
			const firstWidth = ((_a = firstImg.styles) == null ? void 0 : _a.width) ?? 0;
			const firstHeight = ((_b = firstImg.styles) == null ? void 0 : _b.height) ?? 0;
			if (images.every((img) => {
				var _a2, _b2;
				return ((_a2 = img.styles) == null ? void 0 : _a2.width) === firstWidth && ((_b2 = img.styles) == null ? void 0 : _b2.height) === firstHeight;
			})) return true;
		}
	}
	return false;
}
function getNodeIdFromNode(node) {
	var _a;
	return ((_a = node.meta) == null ? void 0 : _a.octoId) ?? `${node.componentName}_${Object.keys(node.styles ?? {}).join("_")}`;
}
function generateRegionName(region, _index) {
	return {
		background: "BackgroundLayer",
		topBar: "StatusBar",
		content: "ContentArea",
		bottomBar: "BottomBar",
		indicator: "PageIndicator",
		gestureBar: "HomeIndicator",
		appGrid: "AppGrid",
		card: "CardArea",
		custom: "CustomArea"
	}[region.type] || "Region";
}
var MIN_REPETITIVE_COUNT = 3;
var ALLOWED_VAR_KEYS = /* @__PURE__ */ new Set([
	"left",
	"top",
	"position",
	"content",
	"src",
	"width",
	"height",
	"fontSize",
	"fontWeight",
	"fontColor",
	"textAlign",
	"lineHeight",
	"opacity",
	"marginLeft",
	"marginRight",
	"marginTop",
	"marginBottom",
	"margin",
	"paddingLeft",
	"paddingRight",
	"paddingTop",
	"paddingBottom",
	"backgroundColor",
	"borderRadius",
	"objectFit",
	"scale",
	"rotate"
]);
var IGNORED_STYLE_KEYS = /* @__PURE__ */ new Set([
	"backgroundImage",
	"backgroundPosition",
	"backgroundRepeat",
	"backgroundSize",
	"border"
]);
function detectRepetitivePattern(node, minCount = MIN_REPETITIVE_COUNT) {
	const children = node.children ?? [];
	if (children.length < minCount) return null;
	if (!children.every((c) => c.componentName === children[0].componentName)) return null;
	if (!checkStructuralIsomorphism(children)) return null;
	if (!checkStyleConsistency(children)) return null;
	const childrenWithRelativeCoords = computeRelativeCoords(children);
	const { params, callParams, pathToParamName } = extractVariations(childrenWithRelativeCoords);
	return {
		builderName: generateBuilderName(node),
		params,
		templateNode: childrenWithRelativeCoords[0],
		callParams,
		pathToParamName
	};
}
function computeRelativeCoords(children) {
	return children.map((child) => {
		var _a, _b, _c, _d;
		const styles = child.styles ?? {};
		const selfLeft = styles.left ?? ((_b = (_a = child.meta) == null ? void 0 : _a.bbox) == null ? void 0 : _b[0]) ?? 0;
		const selfTop = styles.top ?? ((_d = (_c = child.meta) == null ? void 0 : _c.bbox) == null ? void 0 : _d[1]) ?? 0;
		if (selfLeft === 0 && selfTop === 0) return child;
		return adjustSubtreeCoords(child, selfLeft, selfTop);
	});
}
function adjustSubtreeCoords(node, offsetLeft, offsetTop) {
	var _a;
	const adjustedChildren = (_a = node.children) == null ? void 0 : _a.map((child) => {
		var _a2;
		const childStyles = child.styles ? { ...child.styles } : void 0;
		if (childStyles) {
			if (typeof childStyles.left === "number") childStyles.left = childStyles.left - offsetLeft;
			if (typeof childStyles.top === "number") childStyles.top = childStyles.top - offsetTop;
		}
		const deeperAdjusted = (_a2 = child.children) == null ? void 0 : _a2.map((gc) => adjustSubtreeCoords(gc, offsetLeft, offsetTop));
		return {
			...child,
			styles: childStyles,
			children: deeperAdjusted
		};
	});
	return {
		...node,
		children: adjustedChildren
	};
}
function checkStructuralIsomorphism(nodes) {
	if (nodes.length <= 1) return true;
	const first = nodes[0];
	for (let i = 1; i < nodes.length; i++) if (!isStructuralMatch(first, nodes[i])) return false;
	return true;
}
function isStructuralMatch(a, b) {
	if (a.componentName !== b.componentName) return false;
	const aChildren = a.children ?? [];
	const bChildren = b.children ?? [];
	if (aChildren.length !== bChildren.length) return false;
	for (let i = 0; i < aChildren.length; i++) if (!isStructuralMatch(aChildren[i], bChildren[i])) return false;
	return true;
}
function checkStyleConsistency(nodes) {
	if (nodes.length <= 1) return true;
	const firstStyles = nodes[0].styles ?? {};
	const firstKeys = Object.keys(firstStyles);
	const commonKeys = firstKeys.filter((key) => nodes.every((n) => (n.styles ?? {}).hasOwnProperty(key)));
	for (const key of firstKeys) {
		if (commonKeys.includes(key)) continue;
		if (!ALLOWED_VAR_KEYS.has(key) && !IGNORED_STYLE_KEYS.has(key)) return false;
		if (IGNORED_STYLE_KEYS.has(key)) {
			if (!nodes.every((n) => (n.styles ?? {}).hasOwnProperty(key))) return false;
		}
	}
	for (const key of commonKeys) {
		if (ALLOWED_VAR_KEYS.has(key) || IGNORED_STYLE_KEYS.has(key)) continue;
		const firstValue = JSON.stringify(firstStyles[key]);
		for (let i = 1; i < nodes.length; i++) if (JSON.stringify((nodes[i].styles ?? {})[key]) !== firstValue) return false;
	}
	const firstChildren = nodes[0].children ?? [];
	if (firstChildren.length > 0) for (let ci = 0; ci < firstChildren.length; ci++) {
		const childNodes = nodes.map((n) => (n.children ?? [])[ci]).filter(Boolean);
		if (childNodes.length === nodes.length) {
			if (!checkStyleConsistency(childNodes)) return false;
		}
	}
	return true;
}
function getStyleParamName(key) {
	switch (key) {
		case "left": return "x";
		case "top": return "y";
		case "width": return "itemWidth";
		case "height": return "itemHeight";
		case "fontSize": return "fontSize";
		case "fontWeight": return "fontWeight";
		case "fontColor": return "fontColor";
		case "marginLeft": return "marginLeft";
		case "marginTop": return "marginTop";
		case "backgroundColor": return "bgColor";
		default: return key;
	}
}
function getStyleParamType(key, value) {
	if (key === "src") return "Resource";
	if (key === "content") return "string";
	if (typeof value === "number") return "number";
	return "string";
}
function isPositionalStyle(key) {
	return [
		"left",
		"top",
		"x",
		"y"
	].includes(key);
}
function extractVariations(children) {
	const allParamPaths = [];
	const pathSeen = /* @__PURE__ */ new Set();
	const pathToParamName = /* @__PURE__ */ new Map();
	const paramNameCount = /* @__PURE__ */ new Map();
	for (const child of children) collectAllVarPaths(child, "", allParamPaths, pathSeen, pathToParamName, paramNameCount);
	const params = [];
	const paramNameToDef = /* @__PURE__ */ new Map();
	for (const p of allParamPaths) if (!paramNameToDef.has(p.paramName)) {
		const param = {
			name: p.paramName,
			type: p.paramType,
			usage: p.usage
		};
		params.push(param);
		paramNameToDef.set(p.paramName, param);
	}
	const callParams = [];
	for (const child of children) {
		const childParams = [];
		collectAllVarValues(child, "", childParams, paramNameToDef, pathToParamName);
		callParams.push(childParams);
	}
	for (const childParams of callParams) {
		const existingNames = new Set(childParams.map((p) => p.name));
		for (const param of params) if (!existingNames.has(param.name)) {
			const defaultValue = getDefaultStyleValue(param.name, param.type);
			childParams.push({
				name: param.name,
				type: param.type,
				defaultValue,
				usage: param.usage
			});
		}
	}
	const varyingParamNames = [];
	for (const paramName of params.map((p) => p.name)) {
		const entries = callParams.map((cp) => cp.find((p) => p.name === paramName));
		const hasReal = entries.map((e) => e._isReal === true);
		const realCount = hasReal.filter(Boolean).length;
		const values = entries.map((e) => e == null ? void 0 : e.defaultValue);
		const firstRealVal = values.find((_, i) => hasReal[i]);
		const hasVariance = values.some((v) => v !== firstRealVal);
		if (realCount === entries.length) {
			if (hasVariance) varyingParamNames.push(paramName);
			continue;
		}
		if (realCount >= 2 && hasVariance) varyingParamNames.push(paramName);
	}
	const filteredParams = params.filter((p) => varyingParamNames.includes(p.name));
	const filteredCallParams = callParams.map((cp) => {
		const paramMap = new Map(cp.map((p) => [p.name, p]));
		return varyingParamNames.map((name) => paramMap.get(name)).filter(Boolean);
	});
	const filteredPathToParamName = /* @__PURE__ */ new Map();
	for (const [path, name] of pathToParamName) if (varyingParamNames.includes(name)) filteredPathToParamName.set(path, name);
	return {
		params: filteredParams,
		callParams: filteredCallParams,
		pathToParamName: filteredPathToParamName
	};
}
function collectAllVarPaths(node, prefix, result, pathSeen, pathToParamName, paramNameCount) {
	const styles = node.styles ?? {};
	if (typeof styles.left === "number") {
		const path = prefix ? `${prefix}.styles.left` : "styles.left";
		if (!pathSeen.has(path)) {
			pathSeen.add(path);
			const paramName = allocateParamName("x", pathToParamName, path, paramNameCount);
			result.push({
				path,
				paramName,
				paramType: "number",
				usage: "positional"
			});
		}
	}
	if (typeof styles.top === "number") {
		const path = prefix ? `${prefix}.styles.top` : "styles.top";
		if (!pathSeen.has(path)) {
			pathSeen.add(path);
			const paramName = allocateParamName("y", pathToParamName, path, paramNameCount);
			result.push({
				path,
				paramName,
				paramType: "number",
				usage: "positional"
			});
		}
	}
	if (node.content !== void 0) {
		const path = prefix ? `${prefix}.content` : "content";
		if (!pathSeen.has(path)) {
			pathSeen.add(path);
			const paramName = allocateParamName("text", pathToParamName, path, paramNameCount);
			result.push({
				path,
				paramName,
				paramType: "string",
				usage: "positional"
			});
		}
	}
	if (node.src !== void 0) {
		const path = prefix ? `${prefix}.src` : "src";
		if (!pathSeen.has(path)) {
			pathSeen.add(path);
			const paramName = allocateParamName("imageSrc", pathToParamName, path, paramNameCount);
			result.push({
				path,
				paramName,
				paramType: "Resource",
				usage: "repetitive"
			});
		}
	}
	const styleEntries = Object.entries(styles);
	for (const [key, value] of styleEntries) if (ALLOWED_VAR_KEYS.has(key) && value !== void 0) {
		const path = prefix ? `${prefix}.styles.${key}` : `styles.${key}`;
		if (!pathSeen.has(path)) {
			pathSeen.add(path);
			const paramName = allocateParamName(getStyleParamName(key), pathToParamName, path, paramNameCount);
			const paramType = getStyleParamType(key, value);
			const usage = isPositionalStyle(key) ? "positional" : "repetitive";
			result.push({
				path,
				paramName,
				paramType,
				usage
			});
		}
	}
	if (node.children) for (let i = 0; i < node.children.length; i++) collectAllVarPaths(node.children[i], prefix ? `${prefix}.${i}` : String(i), result, pathSeen, pathToParamName, paramNameCount);
}
function allocateParamName(baseName, pathToParamName, path, paramNameCount) {
	const count = paramNameCount.get(baseName) ?? 0;
	paramNameCount.set(baseName, count + 1);
	const paramName = count === 0 ? baseName : `${baseName}_${count + 1}`;
	pathToParamName.set(path, paramName);
	return paramName;
}
function getDefaultStyleValue(paramName, paramType) {
	if (paramType === "Resource") return "$r('app.media.placeholder')";
	if (paramType === "string") return "\"\"";
	return {
		opacity: "1",
		scale: "1"
	}[paramName] ?? "0";
}
function collectAllVarValues(node, prefix, childParams, paramDefs, pathToParamName) {
	const styles = node.styles ?? {};
	if (node.content !== void 0) {
		const path = prefix ? `${prefix}.content` : "content";
		const paramName = pathToParamName.get(path);
		const param = paramName ? paramDefs.get(paramName) : void 0;
		if (param) {
			const cleanContent = node.content.replace(/[\r\n]+/g, " ").trim();
			childParams.push({
				name: param.name,
				type: param.type,
				defaultValue: `"${cleanContent}"`,
				usage: param.usage,
				_isReal: true
			});
		}
	}
	if (node.src !== void 0) {
		const path = prefix ? `${prefix}.src` : "src";
		const paramName = pathToParamName.get(path);
		const param = paramName ? paramDefs.get(paramName) : void 0;
		if (param) {
			const mediaName = node.src.replace(/^assets\//, "").replace(/\.[^.]+$/, "").replace(/-/g, "_");
			childParams.push({
				name: param.name,
				type: param.type,
				defaultValue: `$r('app.media.${mediaName}')`,
				usage: param.usage,
				_isReal: true
			});
		}
	}
	for (const [key, value] of Object.entries(styles)) if (ALLOWED_VAR_KEYS.has(key) && value !== void 0) {
		const path = prefix ? `${prefix}.styles.${key}` : `styles.${key}`;
		const paramName = pathToParamName.get(path);
		const param = paramName ? paramDefs.get(paramName) : void 0;
		if (param) {
			const defaultValue = String(value);
			childParams.push({
				name: param.name,
				type: param.type,
				defaultValue,
				usage: param.usage,
				_isReal: true
			});
		}
	}
	if (node.children) for (let i = 0; i < node.children.length; i++) collectAllVarValues(node.children[i], prefix ? `${prefix}.${i}` : String(i), childParams, paramDefs, pathToParamName);
}
function generateBuilderName(node) {
	var _a, _b;
	const parentName = node.componentName;
	let baseName = "Item";
	switch (parentName) {
		case "Row":
			baseName = "RowItem";
			break;
		case "Column":
			baseName = "ColumnItem";
			break;
		case "Stack":
			baseName = "StackItem";
			break;
		default: baseName = "CustomItem";
	}
	if (node.componentName === "Text" || ((_a = node.children) == null ? void 0 : _a.some((c) => c.componentName === "Text"))) baseName = `TextItem`;
	if (node.componentName === "Image" || ((_b = node.children) == null ? void 0 : _b.some((c) => c.componentName === "Image"))) baseName = `IconItem`;
	return baseName;
}
function detectAllPatterns(node) {
	const patterns = [];
	function traverse(n) {
		if (n.children && n.children.length > 0) {
			if ([
				"Row",
				"Column",
				"Stack"
			].includes(n.componentName)) {
				const pattern = detectRepetitivePattern(n);
				if (pattern) patterns.push(pattern);
			}
			for (const child of n.children) traverse(child);
		}
	}
	traverse(node);
	return patterns;
}
function generateRegionCode(region, _index) {
	const indent = "  ";
	const lines = [];
	lines.push(`${indent}// #region ${region.displayName}`);
	lines.push(`${indent}@Builder`);
	lines.push(`${indent}${region.id}() {`);
	for (const node of region.nodes) {
		const nodeCode = generateV2Node(node, 3);
		lines.push(nodeCode);
	}
	lines.push(`${indent}}`);
	lines.push(`${indent}// #endregion`);
	return lines.join("\n");
}
function generateBackgroundLayerCode(node) {
	const lines = [];
	const indent = "  ";
	lines.push(`${indent}// #region 背景层`);
	lines.push(`${indent}@Builder`);
	lines.push(`${indent}BackgroundLayer() {`);
	const nodeCode = generateV2Node(node, 3);
	lines.push(nodeCode);
	lines.push(`${indent}}`);
	lines.push(`${indent}// #endregion`);
	return lines.join("\n");
}
function generateExtractedBuilderCode(builder, _pattern = null) {
	const lines = [];
	const indent = "  ";
	const paramItems = builder.params.map((p) => `${p.name}: ${p.type}`);
	lines.push(`${indent}@Builder`);
	lines.push(...formatBuilderSignature(builder.name, paramItems, 1));
	const templateCode = generateV2Node(cloneNodeWithParamReplacement(builder.regionNode, builder.params, builder.pathToParamName), 3);
	lines.push(templateCode);
	lines.push(`${indent}}`);
	return lines.join("\n");
}
function cloneNodeWithParamReplacement(node, params, pathToParamName, prefix = "") {
	const paramMap = /* @__PURE__ */ new Map();
	for (const p of params) paramMap.set(p.name, p);
	const cloned = {
		...node,
		styles: node.styles ? { ...node.styles } : void 0,
		children: node.children ? node.children.map((c, i) => cloneNodeWithParamReplacement(c, params, pathToParamName, prefix ? `${prefix}.${i}` : String(i))) : void 0
	};
	const contentPath = prefix ? `${prefix}.content` : "content";
	const textParamName = pathToParamName.get(contentPath);
	const textParam = textParamName ? paramMap.get(textParamName) : void 0;
	if (textParam && cloned.content !== void 0) {
		cloned.content = textParam.name;
		cloned.meta = {
			...cloned.meta,
			isParamRef: true
		};
	}
	const srcPath = prefix ? `${prefix}.src` : "src";
	const imageSrcParamName = pathToParamName.get(srcPath);
	const imageSrcParam = imageSrcParamName ? paramMap.get(imageSrcParamName) : void 0;
	if (imageSrcParam && cloned.src !== void 0) {
		cloned.src = imageSrcParam.name;
		cloned.meta = {
			...cloned.meta,
			isParamRef: true
		};
	}
	if (cloned.styles) {
		for (const [styleKey, _value] of Object.entries(cloned.styles)) {
			const stylePath = prefix ? `${prefix}.styles.${styleKey}` : `styles.${styleKey}`;
			const paramName = pathToParamName.get(stylePath);
			const param = paramName ? paramMap.get(paramName) : void 0;
			if (param) cloned.styles = {
				...cloned.styles,
				[styleKey]: param.name
			};
		}
		for (const [path, paramName] of pathToParamName) {
			const expectedPrefix = prefix ? `${prefix}.styles.` : "styles.";
			if (path.startsWith(expectedPrefix)) {
				const styleKey = path.slice(expectedPrefix.length);
				if (cloned.styles[styleKey] === void 0) {
					const param = paramMap.get(paramName);
					if (param) cloned.styles = {
						...cloned.styles,
						[styleKey]: param.name
					};
				}
			}
		}
	}
	return cloned;
}
function generatePartitionedPageCode(partitionResult, structName) {
	const lines = [];
	const indent = "  ";
	lines.push("@Entry");
	lines.push("@Component");
	lines.push(`struct ${structName} {`);
	setNodeToBuilderMapping(partitionResult.nodeToBuilderMapping, partitionResult.skipNodeIds);
	if (Object.keys(partitionResult.containerParametricCalls).length > 0) setContainerParametricMapping(partitionResult.containerParametricCalls);
	try {
		lines.push(`${indent}build() {`);
		lines.push(`${indent}${indent}Scroll() {`);
		const rootCode = generateV2Node(partitionResult.originalRootNode, 3);
		lines.push(addCommentsToRegionCalls(rootCode, partitionResult.nodeToBuilderMapping, partitionResult.rootRegions));
		lines.push(`${indent}${indent}}`);
		lines.push(`${indent}}`);
	} finally {
		clearNodeToBuilderMapping();
	}
	lines.push("");
	if (partitionResult.backgroundNode) {
		lines.push(generateBackgroundLayerCode(partitionResult.backgroundNode));
		lines.push("");
	}
	for (const builder of partitionResult.extractedBuilders) {
		lines.push(generateExtractedBuilderCode(builder));
		lines.push("");
	}
	try {
		if (Object.keys(partitionResult.containerParametricCalls).length > 0) setContainerParametricMapping(partitionResult.containerParametricCalls);
		for (let i = 0; i < partitionResult.rootRegions.length; i++) {
			const region = partitionResult.rootRegions[i];
			if (region.type === "background") continue;
			lines.push(generateRegionCode(region, i));
			lines.push("");
		}
	} finally {
		clearNodeToBuilderMapping();
	}
	lines.push("}");
	return lines.join("\n");
}
function getSemanticRegionName(region) {
	return {
		background: "背景层",
		topBar: "顶部状态栏",
		content: "内容区域",
		bottomBar: "底部导航栏",
		indicator: "页面指示器",
		gestureBar: "底部手势条",
		appGrid: "应用图标区",
		card: "卡片区域",
		custom: "自定义区域"
	}[region.type] || region.displayName;
}
function addCommentsToRegionCalls(code, _nodeToBuilderMapping, rootRegions) {
	const builderToComment = {};
	for (const region of rootRegions) builderToComment[region.id] = region.displayName;
	builderToComment["BackgroundLayer"] = "背景层";
	return code.replace(/\n(\s+)(this\.([A-Z][a-zA-Z]*)\(\))/g, (match, indent, call, builderName) => {
		const comment = builderToComment[builderName];
		if (comment) return `
${indent}// ${comment}
${indent}${call}`;
		return match;
	});
}
function formatBuilderSignature(builderName, paramItems, indentLevel) {
	const maxLineLen = 120;
	const indent = "  ".repeat(indentLevel);
	const singleLine = `${indent}${builderName}(${paramItems.join(", ")})`;
	if (singleLine.length <= maxLineLen) return [`${singleLine} {`];
	const paramIndent = "  ".repeat(indentLevel + 1);
	const paramLines = paramItems.map((param) => `${paramIndent}${param}`);
	return [
		`${indent}${builderName}(`,
		`${paramLines.join(",\n")}`,
		`${indent}) {`
	];
}
function generatePartitionedArkUI(dsl, options = {}) {
	var _a;
	const systemBarsResult = scanAndSetupSystemBarsV2(dsl.ui.children ?? [], dsl.ui);
	setSkipNodeGuids(systemBarsResult.skipGuids);
	setSystemBarsInfo(systemBarsResult.systemBarsInfo);
	try {
		const partitionResult = recognizeRegions(dsl.ui, getPageSize(dsl.ui), options);
		enhanceRegionsWithPatterns(partitionResult, options);
		assignRegionNames(partitionResult);
		updateNodeToBuilderMapping(partitionResult);
		extractBuildersFromPatterns(partitionResult);
		resetRegistry();
		const code = generatePartitionedPageCode(partitionResult, sanitizeName$1(((_a = dsl.page) == null ? void 0 : _a.name) || "Page"));
		const imports = getImports();
		if (imports.length > 0) return imports.join("\n") + "\n\n" + code;
		return code;
	} finally {
		clearSkipNodeGuids();
		clearSystemBarsInfo();
		clearContainersToAdjustHeight();
	}
}
function getPageSize(ui) {
	const styles = ui.styles ?? {};
	return {
		width: typeof styles.width === "number" ? styles.width : 360,
		height: typeof styles.height === "number" ? styles.height : 780
	};
}
function enhanceRegionsWithPatterns(result, options) {
	var _a;
	if (!(options.detectRepetitivePattern ?? true)) return;
	for (const region of result.rootRegions) {
		for (const node of region.nodes) if ([
			"Row",
			"Column",
			"Stack"
		].includes(node.componentName)) {
			const pattern = detectRepetitivePattern(node);
			if (pattern) {
				region.patterns.push(pattern);
				const containerId = getNodeId(node);
				if (containerId) result.containerToPattern[containerId] = pattern;
			}
		}
		for (const node of region.nodes) {
			const deepPatterns = detectAllPatterns(node);
			for (const dp of deepPatterns) {
				const dpTemplateId = ((_a = dp.templateNode.meta) == null ? void 0 : _a.octoId) ?? getNodeId(dp.templateNode);
				if (!region.patterns.some((p) => {
					var _a2;
					return (((_a2 = p.templateNode.meta) == null ? void 0 : _a2.octoId) ?? getNodeId(p.templateNode)) === dpTemplateId;
				})) region.patterns.push(dp);
			}
		}
	}
}
function assignRegionNames(result) {
	const usedNames = /* @__PURE__ */ new Set();
	for (let i = 0; i < result.rootRegions.length; i++) {
		const region = result.rootRegions[i];
		let baseName = generateRegionName(region);
		let finalName = baseName;
		let counter = 1;
		while (usedNames.has(finalName)) {
			finalName = `${baseName}_${counter}`;
			counter++;
		}
		usedNames.add(finalName);
		region.id = finalName;
		region.displayName = getSemanticRegionName(region);
	}
}
function updateNodeToBuilderMapping(result) {
	for (const region of result.rootRegions) if (region.nodes.length >= 1) {
		const nodeId = getNodeId(region.nodes[0]);
		if (nodeId) result.nodeToBuilderMapping[nodeId] = region.id;
	}
	if (result.backgroundNode) {
		const bgNodeId = getNodeId(result.backgroundNode);
		if (bgNodeId) result.nodeToBuilderMapping[bgNodeId] = "BackgroundLayer";
	}
}
function extractBuildersFromPatterns(result) {
	const minCount = 3;
	const usedBuilderNames = /* @__PURE__ */ new Set();
	const signatureToName = /* @__PURE__ */ new Map();
	const generatedBuilders = [];
	const containerToPatternInfo = /* @__PURE__ */ new Map();
	for (const region of result.rootRegions) for (const pattern of region.patterns) {
		if (pattern.callParams.length < minCount) continue;
		const signature = `${pattern.builderName}(${pattern.params.map((p) => `${p.name}:${p.type}`).join(",")})`;
		let finalName;
		let shouldCreateBuilder = true;
		const existingName = signatureToName.get(signature);
		if (existingName) {
			const existingBuilder = generatedBuilders.find((b) => b.name === existingName);
			if (existingBuilder) if (isTemplateStyleCompatible(existingBuilder.pattern, pattern, existingBuilder.params)) {
				finalName = existingName;
				shouldCreateBuilder = false;
			} else {
				finalName = pattern.builderName;
				if (usedBuilderNames.has(finalName)) {
					let counter = 2;
					while (usedBuilderNames.has(`${finalName}_${counter}`)) counter++;
					finalName = `${finalName}_${counter}`;
				}
			}
			else {
				finalName = existingName;
				shouldCreateBuilder = false;
			}
		} else {
			finalName = pattern.builderName;
			if (usedBuilderNames.has(finalName)) {
				let counter = 2;
				while (usedBuilderNames.has(`${finalName}_${counter}`)) counter++;
				finalName = `${finalName}_${counter}`;
			}
		}
		if (shouldCreateBuilder) {
			usedBuilderNames.add(finalName);
			signatureToName.set(signature, finalName);
			const builder = {
				name: finalName,
				params: pattern.params,
				regionNode: pattern.templateNode,
				pathToParamName: pattern.pathToParamName
			};
			result.extractedBuilders.push(builder);
			generatedBuilders.push({
				name: finalName,
				params: pattern.params,
				pattern
			});
		}
		const containerNode = findContainerOfTemplate(region.nodes, pattern.templateNode);
		if (!containerNode) continue;
		const containerId = getNodeId(containerNode);
		if (!containerId) continue;
		containerToPatternInfo.set(containerId, {
			pattern,
			builderName: finalName,
			containerNode
		});
		if (containerNode.children) for (const child of containerNode.children) {
			const childId = getNodeId(child);
			if (childId) result.skipNodeIds.push(childId);
		}
	}
	const coveredNames = /* @__PURE__ */ new Set();
	for (const builder of generatedBuilders) for (const other of generatedBuilders) {
		if (builder === other) continue;
		if (isCoveredBy(builder, other)) {
			coveredNames.add(builder.name);
			break;
		}
	}
	result.extractedBuilders = result.extractedBuilders.filter((b) => !coveredNames.has(b.name));
	for (const [containerId, info] of containerToPatternInfo) {
		let targetBuilder = null;
		for (const builder of generatedBuilders) {
			if (coveredNames.has(builder.name)) continue;
			if (isCoveredBy({
				name: info.builderName,
				params: info.pattern.params,
				pattern: info.pattern
			}, builder)) {
				targetBuilder = builder;
				break;
			}
		}
		const calls = [];
		for (let i = 0; i < info.pattern.callParams.length; i++) {
			const childArgs = info.pattern.callParams[i];
			const argsMap = new Map(childArgs.map((a) => [a.name, a]));
			const containerOffset = computeNodeOffset(info.containerNode);
			const args = (targetBuilder ? targetBuilder.params : info.pattern.params).map((p) => {
				var _a;
				const arg = argsMap.get(p.name);
				let value;
				if (arg) if (isRootLevelLeftParam(p.name, info.pattern.pathToParamName)) {
					const relVal = parseFloat(arg.defaultValue ?? "0") - ((containerOffset == null ? void 0 : containerOffset.left) ?? 0);
					value = generateArgValue({
						...arg,
						defaultValue: String(relVal)
					});
				} else if (isRootLevelTopParam(p.name, info.pattern.pathToParamName)) {
					const relVal = parseFloat(arg.defaultValue ?? "0") - ((containerOffset == null ? void 0 : containerOffset.top) ?? 0);
					value = generateArgValue({
						...arg,
						defaultValue: String(relVal)
					});
				} else value = generateArgValue(arg);
				else {
					const childNode = (_a = info.containerNode.children) == null ? void 0 : _a[i];
					value = getParamValueFromNode(p.name, childNode, containerOffset);
				}
				return value;
			});
			const targetName = targetBuilder ? targetBuilder.name : info.builderName;
			calls.push(formatBuilderCall(targetName, args));
		}
		result.containerParametricCalls[containerId] = calls;
	}
}
function computeNodeOffset(node) {
	var _a;
	if (!node) return {
		left: 0,
		top: 0
	};
	const styles = node.styles ?? {};
	if (styles.left !== void 0 || styles.top !== void 0) return {
		left: styles.left ?? 0,
		top: styles.top ?? 0
	};
	const bbox = (_a = node.meta) == null ? void 0 : _a.bbox;
	if (bbox && bbox.length >= 2) return {
		left: bbox[0],
		top: bbox[1]
	};
	return {
		left: 0,
		top: 0
	};
}
function isRootLevelLeftParam(paramName, pathToParamName) {
	for (const [path, name] of pathToParamName) if (name === paramName && path === "styles.left") return true;
	return false;
}
function isRootLevelTopParam(paramName, pathToParamName) {
	for (const [path, name] of pathToParamName) if (name === paramName && path === "styles.top") return true;
	return false;
}
function isTemplateStyleCompatible(patternA, patternB, paramsA) {
	const aParamNames = new Set(paramsA.map((p) => p.name));
	const aStyles = patternA.templateNode.styles ?? {};
	const bStyles = patternB.templateNode.styles ?? {};
	const allKeys = /* @__PURE__ */ new Set([...Object.keys(aStyles), ...Object.keys(bStyles)]);
	for (const key of allKeys) {
		if (ALLOWED_VAR_KEYS.has(key) && aParamNames.has(getParamNameFromStyleKey(key))) continue;
		if (IGNORED_STYLE_KEYS.has(key)) {
			if (aStyles.hasOwnProperty(key) !== bStyles.hasOwnProperty(key)) return false;
			continue;
		}
		if (JSON.stringify(aStyles[key]) !== JSON.stringify(bStyles[key])) return false;
	}
	return true;
}
function isCoveredBy(builderA, builderB) {
	if (builderB.params.length < builderA.params.length) return false;
	for (const pA of builderA.params) {
		const pB = builderB.params.find((p) => p.name === pA.name);
		if (!pB) return false;
		if (pB.type !== pA.type) return false;
	}
	if (builderA.pattern && builderB.pattern) {
		const aStyles = builderA.pattern.templateNode.styles ?? {};
		const bStyles = builderB.pattern.templateNode.styles ?? {};
		const aParamNames = new Set(builderA.params.map((p) => p.name));
		const bParamNames = new Set(builderB.params.map((p) => p.name));
		for (const key of Object.keys(aStyles)) {
			if (bStyles[key] === void 0) return false;
			if (JSON.stringify(aStyles[key]) !== JSON.stringify(bStyles[key])) {
				const paramName = getParamNameFromStyleKey(key);
				if (!aParamNames.has(paramName) && !bParamNames.has(paramName)) return false;
			}
		}
	}
	return true;
}
function getParamNameFromStyleKey(key) {
	switch (key) {
		case "left": return "x";
		case "top": return "y";
		case "width": return "itemWidth";
		case "height": return "itemHeight";
		case "fontSize": return "fontSize";
		case "fontWeight": return "fontWeight";
		case "fontColor": return "fontColor";
		case "textAlign": return "textAlign";
		case "lineHeight": return "lineHeight";
		case "marginLeft": return "marginLeft";
		case "marginTop": return "marginTop";
		case "backgroundColor": return "bgColor";
		case "borderRadius": return "borderRadius";
		case "opacity": return "opacity";
		case "objectFit": return "objectFit";
		default: return key;
	}
}
function getParamValueFromNode(paramName, node, containerOffset) {
	if (!node) return "0";
	const styles = node.styles ?? {};
	switch (paramName) {
		case "x": return typeof styles.left === "number" ? String(styles.left - ((containerOffset == null ? void 0 : containerOffset.left) ?? 0)) : "0";
		case "y": return typeof styles.top === "number" ? String(styles.top - ((containerOffset == null ? void 0 : containerOffset.top) ?? 0)) : "0";
		case "itemWidth": return typeof styles.width === "number" ? String(styles.width) : "0";
		case "itemHeight": return typeof styles.height === "number" ? String(styles.height) : "0";
		case "fontSize": return typeof styles.fontSize === "number" ? String(styles.fontSize) : "0";
		case "fontWeight": return typeof styles.fontWeight === "number" ? String(styles.fontWeight) : "0";
		case "fontColor": return styles.fontColor ? `"${styles.fontColor}"` : "\"#000000\"";
		case "marginLeft": return typeof styles.marginLeft === "number" ? String(styles.marginLeft) : "0";
		case "bgColor": return styles.backgroundColor ? `"${styles.backgroundColor}"` : "\"#FFFFFF\"";
		case "borderRadius": return typeof styles.borderRadius === "number" ? String(styles.borderRadius) : "0";
		case "opacity": return typeof styles.opacity === "number" ? String(styles.opacity) : "1";
		default: return "0";
	}
}
function findContainerOfTemplate(nodes, targetNode) {
	for (const node of nodes) if (node.children) {
		if (node.children.includes(targetNode)) return node;
		const found = findContainerOfTemplate(node.children, targetNode);
		if (found) return found;
	}
	return null;
}
function generateArgValue(arg) {
	const value = arg.defaultValue ?? "";
	const type = arg.type;
	if (type === "Resource") return value;
	if (type === "string") {
		if (value.startsWith("\"") && value.endsWith("\"")) return `"${value.slice(1, -1).replace(/[\r\n]+/g, " ").trim()}"`;
		if (!isNaN(Number(value)) && value.trim() !== "") return value;
		return `"${value.replace(/[\r\n]+/g, " ").trim()}"`;
	}
	if (type === "number") return isNaN(Number(value)) ? "0" : String(Number(value));
	if (value.startsWith("\"") && value.endsWith("\"")) return `"${value.slice(1, -1).replace(/[\r\n]+/g, " ").trim()}"`;
	return `"${value.replace(/[\r\n]+/g, " ").trim()}"`;
}
function formatBuilderCall(builderName, args) {
	const maxLineLen = 120;
	const singleLine = `${builderName}(${args.join(", ")})`;
	if (singleLine.length <= maxLineLen) return singleLine;
	const indent = "                ";
	return `${builderName}(
${args.map((arg) => `${indent}${arg}`).join(",\n")}
${indent})`;
}
function sanitizeName$1(name) {
	return name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[0-9]/, "_$&");
}
function generatePartitionedV2Page(dsl, options) {
	return generatePartitionedArkUI(dsl, options);
}
//#endregion
//#region src/arkui/arkts-engine-runtime.ts
/**
* vendor/arkts-engine.js 是仓库内跟踪的 vendored ESM runtime。
* 在这个薄边界集中声明它对端到端 Pixso 入口所需的最小类型。
*/
var generatePartitionedArkUICode = generatePartitionedV2Page;
//#endregion
//#region src/parsers/pixso/pixso-refs-hydration.ts
var MAX_COMPONENT_DEPTH = 32;
var hasOwn$2 = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function isRecord$5(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmptyString$4(value) {
	return typeof value === "string" && value.trim().length > 0 ? value : void 0;
}
/**
* JSON records inherit field-by-field, while arrays and scalar values are
* replacements. Presence, rather than truthiness, decides precedence so that
* 0, false, null and [] remain meaningful instance overrides.
*/
function mergeRecords$1(base, replacement) {
	const result = { ...base };
	for (const [key, value] of Object.entries(replacement)) {
		const inherited = result[key];
		result[key] = isRecord$5(inherited) && isRecord$5(value) ? mergeRecords$1(inherited, value) : value;
	}
	return result;
}
function effectiveNodeFields(node) {
	const base = {};
	for (const [key, value] of Object.entries(node)) if (key !== "children" && key !== "override") base[key] = value;
	const override = isRecord$5(node.override) ? node.override : void 0;
	const merged = override ? mergeRecords$1(base, override) : base;
	merged.type = node.type;
	if (hasOwn$2(node, "id")) merged.id = node.id;
	else delete merged.id;
	return merged;
}
function explicitChildren(node) {
	const override = isRecord$5(node.override) ? node.override : void 0;
	if (override && hasOwn$2(override, "children")) return {
		present: true,
		value: Array.isArray(override.children) ? override.children : []
	};
	return {
		present: hasOwn$2(node, "children"),
		value: Array.isArray(node.children) ? node.children : []
	};
}
function masterSlotRef(node) {
	const fields = effectiveNodeFields(node);
	return nonEmptyString$4(fields.componentNodeRef) ?? nonEmptyString$4(fields.id);
}
function occurrenceSlotRef(node) {
	return nonEmptyString$4(effectiveNodeFields(node).componentNodeRef);
}
function nodeSignature(node) {
	const fields = effectiveNodeFields(node);
	return [
		nonEmptyString$4(fields.type) ?? "",
		nonEmptyString$4(fields.name) ?? "",
		nonEmptyString$4(fields.componentRef) ?? ""
	].join("\0");
}
function isCompleteComponentRoot(node) {
	if (hasOwn$2(node, "children")) return true;
	const dimensionStubKeys = new Set([
		"id",
		"type",
		"name",
		"box",
		"componentKey"
	]);
	return Object.keys(node).some((key) => !dimensionStubKeys.has(key));
}
function mergeNodeFields(template, occurrence, componentRoot) {
	const inherited = effectiveNodeFields(template);
	const replacement = occurrence ? effectiveNodeFields(occurrence) : {};
	const templateId = nonEmptyString$4(inherited.id);
	const occurrenceId = nonEmptyString$4(replacement.id);
	delete inherited.id;
	delete replacement.id;
	if (componentRoot && isRecord$5(inherited.box)) {
		const box = { ...inherited.box };
		delete box.x;
		delete box.y;
		inherited.box = box;
	}
	const merged = mergeRecords$1(inherited, replacement);
	merged.type = nonEmptyString$4(replacement.type) ?? nonEmptyString$4(inherited.type) ?? template.type;
	if (occurrenceId) merged.id = occurrenceId;
	else delete merged.id;
	const slotRef = occurrence ? occurrenceSlotRef(occurrence) ?? (componentRoot ? void 0 : masterSlotRef(template)) : componentRoot ? void 0 : masterSlotRef(template);
	if (slotRef) merged.componentNodeRef = slotRef;
	else delete merged.componentNodeRef;
	if (!occurrenceId && templateId && merged.id === templateId) delete merged.id;
	delete merged.override;
	delete merged.children;
	return merged;
}
function matchOccurrenceChildren(templates, occurrences) {
	const byTemplateIndex = /* @__PURE__ */ new Map();
	const usedTemplates = /* @__PURE__ */ new Set();
	const matchedOccurrenceIndexes = /* @__PURE__ */ new Map();
	const templateRefToIndex = /* @__PURE__ */ new Map();
	templates.forEach((template, index) => {
		const ref = masterSlotRef(template);
		if (ref && !templateRefToIndex.has(ref)) templateRefToIndex.set(ref, index);
	});
	occurrences.forEach((occurrence, occurrenceIndex) => {
		const ref = occurrenceSlotRef(occurrence);
		const templateIndex = ref ? templateRefToIndex.get(ref) : void 0;
		if (templateIndex === void 0 || usedTemplates.has(templateIndex)) return;
		usedTemplates.add(templateIndex);
		byTemplateIndex.set(templateIndex, occurrence);
		matchedOccurrenceIndexes.set(occurrenceIndex, templateIndex);
	});
	const keyedAnchors = [...matchedOccurrenceIndexes.entries()].sort(([left], [right]) => left - right);
	const gapCursors = /* @__PURE__ */ new Map();
	occurrences.forEach((occurrence, occurrenceIndex) => {
		if (matchedOccurrenceIndexes.has(occurrenceIndex) || occurrenceSlotRef(occurrence)) return;
		const previous = [...keyedAnchors].reverse().find(([index]) => index < occurrenceIndex);
		const next = keyedAnchors.find(([index]) => index > occurrenceIndex);
		const start = previous ? previous[1] + 1 : 0;
		const end = next ? next[1] : templates.length;
		if (start >= end) return;
		const signature = nodeSignature(occurrence);
		const gapKey = `${start}:${end}`;
		const cursor = gapCursors.get(gapKey) ?? start;
		let templateIndex = -1;
		for (let index = cursor; index < end; index += 1) if (!usedTemplates.has(index) && nodeSignature(templates[index]) === signature) {
			templateIndex = index;
			break;
		}
		if (templateIndex < 0) return;
		gapCursors.set(gapKey, templateIndex + 1);
		usedTemplates.add(templateIndex);
		byTemplateIndex.set(templateIndex, occurrence);
		matchedOccurrenceIndexes.set(occurrenceIndex, templateIndex);
	});
	const additionsBefore = /* @__PURE__ */ new Map();
	const trailingAdditions = [];
	occurrences.forEach((occurrence, occurrenceIndex) => {
		if (matchedOccurrenceIndexes.has(occurrenceIndex)) return;
		let nextTemplateIndex;
		for (let next = occurrenceIndex + 1; next < occurrences.length; next += 1) {
			const matched = matchedOccurrenceIndexes.get(next);
			if (matched !== void 0) {
				nextTemplateIndex = matched;
				break;
			}
		}
		if (nextTemplateIndex === void 0) {
			trailingAdditions.push(occurrence);
			return;
		}
		const bucket = additionsBefore.get(nextTemplateIndex) ?? [];
		bucket.push(occurrence);
		additionsBefore.set(nextTemplateIndex, bucket);
	});
	return {
		byTemplateIndex,
		additionsBefore,
		trailingAdditions
	};
}
function reportIssue(ctx, code, node, componentRef, path) {
	ctx.issues.push({
		code,
		node,
		componentRef,
		path
	});
	return node;
}
function resolveStandaloneNode(source, componentStack, path, ctx) {
	if (effectiveNodeFields(source).visible === false) return { ...source };
	const childState = explicitChildren(source);
	if (source.type === "INSTANCE") {
		const fields = effectiveNodeFields(source);
		fields.type = source.type;
		delete fields.override;
		if (childState.present) fields.children = childState.value;
		else delete fields.children;
		return hydrateInstance(fields, componentStack, path, ctx);
	}
	const fields = { ...source };
	if (childState.present) fields.children = childState.value.map((child, index) => resolveStandaloneNode(child, componentStack, `${path}.${index}`, ctx));
	else delete fields.children;
	return fields;
}
function mergeTemplateNode(template, occurrence, componentRoot, componentStack, path, ctx) {
	const merged = mergeNodeFields(template, occurrence, componentRoot);
	if (merged.visible === false) return merged;
	const templateComponentRef = nonEmptyString$4(effectiveNodeFields(template).componentRef);
	const occurrenceComponentRef = occurrence ? nonEmptyString$4(effectiveNodeFields(occurrence).componentRef) : void 0;
	const templateChildren = !componentRoot && template.type === "INSTANCE" && templateComponentRef !== void 0 && occurrenceComponentRef !== void 0 && templateComponentRef !== occurrenceComponentRef ? [] : explicitChildren(template).value;
	const occurrenceChildren = occurrence ? explicitChildren(occurrence) : {
		present: false,
		value: []
	};
	if (ctx.occurrenceDriven === true && occurrence !== void 0 && nonEmptyString$4(occurrence.id) !== void 0 && occurrenceChildren.present) {
		const slotTemplates = /* @__PURE__ */ new Map();
		for (const child of templateChildren) {
			const ref = masterSlotRef(child);
			if (ref && !slotTemplates.has(ref)) slotTemplates.set(ref, child);
		}
		const children = occurrenceChildren.value.map((child, index) => {
			const slot = occurrenceSlotRef(child);
			const slotTemplate = slot ? slotTemplates.get(slot) : void 0;
			if (slotTemplate) return mergeTemplateNode(slotTemplate, child, false, componentStack, `${path}.${slot}`, ctx);
			return resolveStandaloneNode(child, componentStack, `${path}.occ-${index}`, ctx);
		});
		if (children.length > 0 || occurrenceChildren.value.length === 0) merged.children = children;
		else delete merged.children;
		if (!componentRoot && merged.type === "INSTANCE") return hydrateInstance(merged, componentStack, path, ctx);
		return merged;
	}
	let children = [];
	if (occurrenceChildren.present && occurrenceChildren.value.length === 0) children = [];
	else if (templateChildren.length === 0) children = occurrenceChildren.value.map((child, index) => resolveStandaloneNode(child, componentStack, `${path}.new-${index}`, ctx));
	else {
		const matches = matchOccurrenceChildren(templateChildren, occurrenceChildren.value);
		for (let index = 0; index < templateChildren.length; index += 1) {
			for (const addition of matches.additionsBefore.get(index) ?? []) children.push(resolveStandaloneNode(addition, componentStack, `${path}.before-${index}-${children.length}`, ctx));
			children.push(mergeTemplateNode(templateChildren[index], matches.byTemplateIndex.get(index), false, componentStack, `${path}.${masterSlotRef(templateChildren[index]) ?? index}`, ctx));
		}
		matches.trailingAdditions.forEach((addition, index) => {
			children.push(resolveStandaloneNode(addition, componentStack, `${path}.after-${index}`, ctx));
		});
	}
	if (children.length > 0 || occurrenceChildren.present && occurrenceChildren.value.length === 0) merged.children = children;
	else delete merged.children;
	if (!componentRoot && merged.type === "INSTANCE") return hydrateInstance(merged, componentStack, path, ctx);
	return merged;
}
function hydrateInstance(occurrence, componentStack, path, ctx) {
	const componentRef = nonEmptyString$4(effectiveNodeFields(occurrence).componentRef);
	if (!componentRef) return reportIssue(ctx, "missing-component-ref", occurrence, void 0, path);
	if (componentStack.includes(componentRef) || componentStack.length >= MAX_COMPONENT_DEPTH) return reportIssue(ctx, "cyclic-component-ref", occurrence, componentRef, path);
	const master = ctx.componentRoots[componentRef];
	if (!master || !isCompleteComponentRoot(master)) return reportIssue(ctx, "missing-component-root", occurrence, componentRef, path);
	const hydrated = mergeTemplateNode(master, occurrence, true, [...componentStack, componentRef], `${path}@${componentRef}`, ctx);
	ctx.hydratedInstances.add(hydrated);
	return hydrated;
}
/**
* Resolves compact INSTANCE records against same-format component masters.
* The output remains Pixso refs data; no legacy Pixso/Octo conversion occurs.
*/
function hydratePixsoRefsRoots(input, options = {}) {
	const hydratedInstances = /* @__PURE__ */ new WeakSet();
	const issues = [];
	const ctx = {
		componentRoots: input.resolvedRefs?.componentRoots ?? {},
		hydratedInstances,
		issues,
		...options.occurrenceDriven === true ? { occurrenceDriven: true } : {}
	};
	return {
		roots: input.roots.map((root, index) => resolveStandaloneNode(root, [], `root.${index}`, ctx)),
		hydratedInstances,
		issues
	};
}
//#endregion
//#region src/parsers/pixso/pixso-refs-format.ts
var hasOwn$1 = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function isRecord$4(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finiteNumber$3(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function finiteNonNegative$1(value) {
	const number = finiteNumber$3(value);
	return number !== void 0 && number >= 0 ? number : void 0;
}
function nonEmptyString$3(value) {
	return typeof value === "string" && value.trim().length > 0 ? value : void 0;
}
function isRootNode(value) {
	if (!isRecord$4(value) || !nonEmptyString$3(value.type) || !isRecord$4(value.box)) return false;
	return finiteNonNegative$1(value.box.w) !== void 0 && finiteNonNegative$1(value.box.h) !== void 0;
}
function isPixsoRefsRoot(value) {
	if (!isRecord$4(value) || !Array.isArray(value.roots) || value.roots.length === 0) return false;
	if (!isRecord$4(value.refsIndex)) return false;
	return value.roots.every(isRootNode) && value.roots.some((root) => effectiveField$1(root, "visible") !== false);
}
function effectiveOverride$1(node) {
	return isRecord$4(node.override) ? node.override : void 0;
}
function effectiveField$1(node, key) {
	const override = effectiveOverride$1(node);
	return override && hasOwn$1(override, key) ? override[key] : node[key];
}
//#endregion
//#region src/parsers/pixso/pixso-refs-raw-format.ts
var hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function isRecord$3(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finiteNumber$2(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function finiteNonNegative(value) {
	const number = finiteNumber$2(value);
	return number !== void 0 && number >= 0 ? number : void 0;
}
function nonEmptyString$2(value) {
	return typeof value === "string" && value.trim().length > 0 ? value : void 0;
}
function mergeRecords(base, replacement) {
	const result = { ...base };
	for (const [key, value] of Object.entries(replacement)) {
		const inherited = result[key];
		result[key] = isRecord$3(inherited) && isRecord$3(value) ? mergeRecords(inherited, value) : value;
	}
	return result;
}
function effectiveOverride(node) {
	return isRecord$3(node.override) ? node.override : void 0;
}
function effectiveField(node, key) {
	const override = effectiveOverride(node);
	return override && hasOwn(override, key) ? override[key] : node[key];
}
function effectiveRecord(node, key) {
	const base = isRecord$3(node[key]) ? node[key] : void 0;
	const override = effectiveOverride(node);
	const replacement = override && isRecord$3(override[key]) ? override[key] : void 0;
	if (!base && !replacement) return void 0;
	return replacement ? mergeRecords(base ?? {}, replacement) : { ...base };
}
function effectiveArray(node, key) {
	const value = effectiveField(node, key);
	return Array.isArray(value) ? value : [];
}
function effectiveBox(node) {
	return effectiveRecord(node, "box") ?? {};
}
function encodePathPart(value) {
	return Array.from(value, (character) => /^[a-zA-Z0-9._-]$/.test(character) ? character : `~${character.codePointAt(0).toString(16)}~`).join("");
}
function sourceId(node) {
	return nonEmptyString$2(node.id);
}
function scopedSyntheticKey(rootScope, path, node) {
	return `pixso:refs:synthetic:${encodePathPart(rootScope)}:${path}:${encodePathPart(node.type)}`;
}
function nodeKey(node, rootScope, path) {
	return sourceId(node) ?? scopedSyntheticKey(rootScope, path, node);
}
function shallowSource(node) {
	const source = {};
	for (const [key, value] of Object.entries(node)) if (key !== "children") source[key] = value;
	return source;
}
function styleId(value) {
	return value.startsWith("style:") ? value.slice(6) : value;
}
function styleAliases(value) {
	const normalized = styleId(value);
	const slash = normalized.indexOf("/");
	return slash > 0 ? [normalized, normalized.slice(0, slash)] : [normalized];
}
function styleReference(value) {
	return typeof value === "string" && value.startsWith("style:") ? value : void 0;
}
function nodeStyleReferences(node) {
	const result = [];
	for (const key of [
		"fills",
		"strokes",
		"effects"
	]) for (const value of effectiveArray(node, key)) {
		const reference = styleReference(value);
		if (reference) result.push(reference);
	}
	const textReference = styleReference(effectiveRecord(node, "text")?.style);
	if (textReference) result.push(textReference);
	return [...new Set(result)];
}
function styleEntryIds(entry) {
	const result = [];
	for (const key of [
		"id",
		"key",
		"ref",
		"styleId",
		"style_id",
		"style_key"
	]) {
		const value = nonEmptyString$2(entry[key]);
		if (value) result.push(...styleAliases(value));
	}
	return [...new Set(result)];
}
function registerStyleEntry(map, key, entry) {
	for (const alias of [...styleAliases(key), ...styleEntryIds(entry)]) if (!map.has(alias)) map.set(alias, entry);
}
function createStyleResolver(input) {
	const entries = /* @__PURE__ */ new Map();
	const collection = input.resolvedRefs?.styles;
	if (Array.isArray(collection)) for (const entry of collection) {
		if (!isRecord$3(entry)) continue;
		for (const id of styleEntryIds(entry)) registerStyleEntry(entries, id, entry);
	}
	else if (isRecord$3(collection)) {
		for (const [key, value] of Object.entries(collection)) if (isRecord$3(value)) registerStyleEntry(entries, key, value);
	}
	const metadata = /* @__PURE__ */ new Map();
	for (const entry of Array.isArray(input.refsIndex.styles) ? input.refsIndex.styles : []) {
		if (!isRecord$3(entry)) continue;
		const ids = styleEntryIds(entry);
		for (const id of ids) for (const alias of styleAliases(id)) if (!metadata.has(alias)) metadata.set(alias, entry);
	}
	return {
		entries,
		metadata
	};
}
function resolvedStyle(reference, ctx) {
	ctx.usedStyleRefs.add(reference);
	for (const alias of styleAliases(reference)) {
		const entry = ctx.styles.entries.get(alias);
		if (entry) return entry;
	}
	ctx.unresolvedStyleRefs.add(reference);
}
var STYLE_WRAPPER_KEYS = [
	"style_value",
	"styleValue",
	"style",
	"value",
	"data"
];
function styleLayers(entry) {
	const result = [];
	const seen = /* @__PURE__ */ new Set();
	const visit = (value, depth) => {
		if (depth > 8 || seen.has(value)) return;
		seen.add(value);
		result.push(value);
		for (const key of STYLE_WRAPPER_KEYS) {
			const nested = value[key];
			if (isRecord$3(nested)) visit(nested, depth + 1);
		}
	};
	visit(entry, 0);
	return result;
}
function recordArrayField(entry, keys) {
	for (const layer of styleLayers(entry)) for (const key of keys) {
		const value = layer[key];
		if (Array.isArray(value)) return value.filter(isRecord$3);
		if (isRecord$3(value)) return [value];
	}
	return [];
}
function normalizeChannel$1(value) {
	return Math.max(0, Math.min(255, Math.round(value)));
}
function normalizeAlpha(value, fallback = 1) {
	const alpha = finiteNumber$2(value) ?? fallback;
	return Math.max(0, Math.min(1, alpha));
}
function colorFromObject(value) {
	if (value.type === "color") {
		const red = finiteNumber$2(value.red);
		const green = finiteNumber$2(value.green);
		const blue = finiteNumber$2(value.blue);
		if (red === void 0 || green === void 0 || blue === void 0) return void 0;
		return {
			type: "color",
			red: normalizeChannel$1(red),
			green: normalizeChannel$1(green),
			blue: normalizeChannel$1(blue),
			alpha: normalizeAlpha(value.alpha)
		};
	}
	const shortRed = finiteNumber$2(value.r);
	const shortGreen = finiteNumber$2(value.g);
	const shortBlue = finiteNumber$2(value.b);
	if (shortRed !== void 0 && shortGreen !== void 0 && shortBlue !== void 0) {
		const normalized = Math.max(shortRed, shortGreen, shortBlue) <= 1;
		return {
			type: "color",
			red: normalizeChannel$1(normalized ? shortRed * 255 : shortRed),
			green: normalizeChannel$1(normalized ? shortGreen * 255 : shortGreen),
			blue: normalizeChannel$1(normalized ? shortBlue * 255 : shortBlue),
			alpha: normalizeAlpha(value.a ?? value.alpha)
		};
	}
	const red = finiteNumber$2(value.red);
	const green = finiteNumber$2(value.green);
	const blue = finiteNumber$2(value.blue);
	if (red === void 0 || green === void 0 || blue === void 0) return void 0;
	return {
		type: "color",
		red: normalizeChannel$1(red),
		green: normalizeChannel$1(green),
		blue: normalizeChannel$1(blue),
		alpha: normalizeAlpha(value.alpha ?? value.a)
	};
}
function colorFromHex(value) {
	const match = value.trim().match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
	if (!match) return void 0;
	const source = match[1];
	const expanded = source.length <= 4 ? Array.from(source, (character) => `${character}${character}`).join("") : source;
	return {
		type: "color",
		red: Number.parseInt(expanded.slice(0, 2), 16),
		green: Number.parseInt(expanded.slice(2, 4), 16),
		blue: Number.parseInt(expanded.slice(4, 6), 16),
		alpha: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1
	};
}
function colorComponent(value) {
	const normalized = value.trim();
	if (normalized.endsWith("%")) {
		const percent = Number.parseFloat(normalized.slice(0, -1));
		return Number.isFinite(percent) ? normalizeChannel$1(percent * 2.55) : void 0;
	}
	const number = Number.parseFloat(normalized);
	return Number.isFinite(number) ? normalizeChannel$1(number) : void 0;
}
function colorFromRgb(value) {
	const match = value.trim().match(/^rgba?\((.*)\)$/i);
	if (!match) return void 0;
	const parts = match[1].replace("/", ",").split(/[\s,]+/).filter(Boolean);
	if (parts.length < 3) return void 0;
	const red = colorComponent(parts[0]);
	const green = colorComponent(parts[1]);
	const blue = colorComponent(parts[2]);
	if (red === void 0 || green === void 0 || blue === void 0) return void 0;
	const alphaPart = parts[3];
	return {
		type: "color",
		red,
		green,
		blue,
		alpha: normalizeAlpha(alphaPart?.endsWith("%") ? Number.parseFloat(alphaPart.slice(0, -1)) / 100 : alphaPart === void 0 ? 1 : Number.parseFloat(alphaPart))
	};
}
function rawColor(value) {
	if (isRecord$3(value)) return colorFromObject(value);
	if (typeof value !== "string") return void 0;
	return colorFromHex(value) ?? colorFromRgb(value);
}
function applyPaintOpacity(color, opacity) {
	const paintOpacity = finiteNumber$2(opacity);
	if (paintOpacity === void 0) return color;
	const normalized = normalizeAlpha(paintOpacity);
	const alpha = Math.abs(normalized - color.alpha) < 1e-6 ? color.alpha : color.alpha * normalized;
	return {
		...color,
		alpha: normalizeAlpha(alpha)
	};
}
function point(value) {
	if (!Array.isArray(value) || value.length < 2) return void 0;
	const x = finiteNumber$2(value[0]);
	const y = finiteNumber$2(value[1]);
	return x !== void 0 && y !== void 0 ? [x, y] : void 0;
}
function gradientStop(value) {
	if (Array.isArray(value)) {
		const color = rawColor(value[0]);
		const ratio = finiteNumber$2(value[1]);
		return color && ratio !== void 0 ? {
			color,
			ratio
		} : void 0;
	}
	if (!isRecord$3(value)) return void 0;
	const color = rawColor(value.color ?? value.value);
	const ratio = finiteNumber$2(value.ratio ?? value.position ?? value.offset);
	return color && ratio !== void 0 ? {
		color,
		ratio
	} : void 0;
}
function rawGradient(value) {
	const normalizedType = (nonEmptyString$2(value.value) ?? nonEmptyString$2(value.type))?.toUpperCase();
	const type = normalizedType?.includes("RADIAL") ? "radial" : normalizedType?.includes("ANGULAR") || normalizedType?.includes("CONIC") ? "angular" : normalizedType?.includes("GRADIENT") || normalizedType === "LINEAR" ? "linear" : void 0;
	if (!type) return void 0;
	const gradientRange = (Array.isArray(value.stops) ? value.stops : Array.isArray(value.gradient_range) ? value.gradient_range : []).map(gradientStop).filter((entry) => entry !== void 0);
	if (gradientRange.length === 0) return void 0;
	const points = Array.isArray(value.points) ? value.points : [];
	const minorAxis = point(value.minor_axis_point) ?? point(points[0]) ?? [1, 0];
	return {
		type,
		center_point: point(value.center_point) ?? point(points[1]) ?? [0, 0],
		long_axis_point: point(value.long_axis_point) ?? point(points[2]) ?? [0, 1],
		minor_axis_point: minorAxis,
		gradient_range: gradientRange
	};
}
function rawBackground(value) {
	if (!isRecord$3(value)) return rawColor(value);
	return rawColor(value) ?? rawGradient(value);
}
function paintType(value) {
	return nonEmptyString$2(value.type)?.toLowerCase();
}
function visiblePaint(value) {
	return value.visible !== false && finiteNumber$2(value.opacity) !== 0;
}
function paintColor(paint) {
	const color = rawColor(paint.color ?? paint.value);
	return color ? applyPaintOpacity(color, paint.opacity) : void 0;
}
function rawCorner(value) {
	const uniform = finiteNumber$2(value);
	if (uniform !== void 0) return [
		uniform,
		uniform,
		uniform,
		uniform
	];
	if (Array.isArray(value) && value.length === 4) {
		const values = value.map(finiteNumber$2);
		if (values.every((entry) => entry !== void 0)) return [
			values[0],
			values[1],
			values[2],
			values[3]
		];
	}
	if (!isRecord$3(value)) return void 0;
	const topLeft = finiteNumber$2(value.topLeft ?? value.top_left);
	const topRight = finiteNumber$2(value.topRight ?? value.top_right);
	const bottomRight = finiteNumber$2(value.bottomRight ?? value.bottom_right);
	const bottomLeft = finiteNumber$2(value.bottomLeft ?? value.bottom_left);
	if ([
		topLeft,
		topRight,
		bottomRight,
		bottomLeft
	].every((entry) => entry === void 0)) return void 0;
	return [
		topLeft ?? 0,
		topRight ?? 0,
		bottomRight ?? 0,
		bottomLeft ?? 0
	];
}
function rawBorders(value) {
	if (!Array.isArray(value)) return void 0;
	const result = [];
	for (const entry of value) {
		if (!isRecord$3(entry)) continue;
		const position = nonEmptyString$2(entry.position)?.toLowerCase();
		const width = finiteNonNegative(entry.width);
		if (width === void 0 || position !== "top" && position !== "right" && position !== "bottom" && position !== "left") continue;
		result.push({
			position,
			style: nonEmptyString$2(entry.style) ?? "solid",
			width,
			...rawColor(entry.color) ? { color: rawColor(entry.color) } : {}
		});
	}
	return result.length > 0 ? result : void 0;
}
function rawShadows(value) {
	if (!Array.isArray(value)) return void 0;
	const result = [];
	for (const entry of value) {
		if (!isRecord$3(entry)) continue;
		const color = rawColor(entry.color);
		if (!color) continue;
		result.push({
			type: String(entry.type).toLowerCase().includes("inner") ? "inner" : "outer",
			color,
			x: finiteNumber$2(entry.x) ?? 0,
			y: finiteNumber$2(entry.y) ?? 0,
			blur: Math.max(0, finiteNumber$2(entry.blur) ?? 0),
			...finiteNumber$2(entry.spread) !== void 0 ? { spread: finiteNumber$2(entry.spread) } : {}
		});
	}
	return result.length > 0 ? result : void 0;
}
function rawFilters(value) {
	if (!Array.isArray(value)) return void 0;
	const result = [];
	for (const entry of value) {
		if (!isRecord$3(entry)) continue;
		const amount = finiteNonNegative(entry.value);
		if (amount === void 0) continue;
		result.push({
			type: String(entry.type).toLowerCase() === "background" ? "background" : "layer",
			value: amount
		});
	}
	return result.length > 0 ? result : void 0;
}
function normalizeTextHorizontal$1(value) {
	if (typeof value !== "string") return void 0;
	const normalized = value.toLowerCase();
	return normalized === "left" || normalized === "center" || normalized === "right" || normalized === "justify" ? normalized : void 0;
}
function normalizeTextVertical$1(value) {
	if (typeof value !== "string") return void 0;
	const normalized = value.toLowerCase();
	if (normalized === "center" || normalized === "middle") return "center";
	return normalized === "top" || normalized === "bottom" ? normalized : void 0;
}
function fontWeight(value) {
	const number = finiteNumber$2(value);
	if (number !== void 0) return number;
	if (typeof value !== "string") return void 0;
	const numeric = Number.parseFloat(value);
	if (Number.isFinite(numeric)) return numeric;
	const normalized = value.toLowerCase();
	if (normalized.includes("thin")) return 100;
	if (normalized.includes("light")) return 300;
	if (normalized.includes("medium")) return 500;
	if (normalized.includes("semi")) return 600;
	if (normalized.includes("bold")) return 700;
	if (normalized.includes("black")) return 900;
	return normalized.includes("regular") || normalized.includes("normal") ? 400 : void 0;
}
function textNumber(value) {
	if (isRecord$3(value)) return finiteNumber$2(value.value ?? value.number);
	return finiteNumber$2(value);
}
function applyTextRecord(style, value) {
	const family = nonEmptyString$2(value.fontFamily ?? value.font_family);
	const size = textNumber(value.fontSize ?? value.font_size);
	const weight = fontWeight(value.fontWeight ?? value.font_weight ?? value.fontStyle);
	const lineHeight = textNumber(value.lineHeight ?? value.lineHeightNumber ?? value.line_height);
	const spacing = textNumber(value.letterSpacing ?? value.letterSpacingNumber ?? value.letter_spacing);
	if (family) style.font_family = family;
	if (size !== void 0) style.font_size = size;
	if (weight !== void 0) style.font_weight = weight;
	if (lineHeight !== void 0) style.line_height = lineHeight;
	if (spacing !== void 0) style.letter_spacing = nonEmptyString$2(value.letterSpacingUnit)?.toUpperCase() === "PERCENT" && size !== void 0 ? size * spacing / 100 : spacing;
	const horizontal = normalizeTextHorizontal$1(value.textAlignHorizontal ?? value.text_align_horizontal);
	const vertical = normalizeTextVertical$1(value.textAlignVertical ?? value.text_align_vertical);
	if (horizontal) style.text_align_horizontal = horizontal;
	if (vertical) style.text_align_vertical = vertical;
}
var HARMONY_TYPOGRAPHY_FONT_SIZES = {
	BODY_L: 16,
	BODY_M: 14,
	BODY_S: 12,
	CAPTION_L: 12,
	CAPTION_M: 10,
	SUBTITLE_L: 18,
	SUBTITLE_M: 16,
	SUBTITLE_S: 14,
	TITLE_L: 30,
	TITLE_M: 24,
	TITLE_S: 20
};
function metadataStyle(reference, ctx) {
	for (const alias of styleAliases(reference)) {
		const entry = ctx.styles.metadata.get(alias);
		if (entry) return entry;
	}
}
function applyTextStyleMetadataFallback(style, node, ctx) {
	const reference = styleReference(effectiveRecord(node, "text")?.style);
	if (!reference) return;
	const metadata = metadataStyle(reference, ctx);
	if (!metadata) return;
	const fallback = {};
	for (const layer of [...styleLayers(metadata)].reverse()) applyTextRecord(fallback, layer);
	const match = nonEmptyString$2(metadata.style_name ?? metadata.styleName ?? metadata.name)?.match(/^Font\/([A-Za-z]+_[A-Za-z]+)\/([^/]+)$/i);
	if (match) {
		fallback.font_size ??= HARMONY_TYPOGRAPHY_FONT_SIZES[match[1].toUpperCase()];
		fallback.font_weight ??= fontWeight(match[2]);
		fallback.font_family ??= "HarmonyHeiTi";
	}
	for (const key of [
		"font_family",
		"font_size",
		"font_weight",
		"line_height",
		"letter_spacing",
		"text_align_horizontal",
		"text_align_vertical"
	]) if (style[key] === void 0 && fallback[key] !== void 0) Object.assign(style, { [key]: fallback[key] });
}
function assetReference$1(path, ctx) {
	let index = ctx.assetIndexes.get(path);
	if (index === void 0) {
		index = ctx.assets.length;
		ctx.assets.push(path);
		ctx.assetIndexes.set(path, index);
	}
	return `$${index}`;
}
function applyRawStyleRecord(style, record, isText, ctx) {
	const background = rawBackground(record.background_color);
	const foreground = rawColor(record.font_color);
	if (background) if (isText && background.type === "color") style.font_color = background;
	else style.background_color = background;
	if (foreground) style.font_color = foreground;
	const image = nonEmptyString$2(record.background_image);
	if (image && !image.startsWith("$")) style.background_image = assetReference$1(image, ctx);
	for (const key of [
		"background_position",
		"background_repeat",
		"background_size"
	]) {
		const value = nonEmptyString$2(record[key]);
		if (value) style[key] = value;
	}
	applyTextRecord(style, record);
	const opacity = finiteNumber$2(record.opacity);
	const rotation = finiteNumber$2(record.rotation_angle);
	if (opacity !== void 0) style.opacity = Math.max(0, Math.min(1, opacity));
	if (rotation !== void 0) style.rotation_angle = rotation;
	const corner = rawCorner(record.round_corner);
	const border = rawBorders(record.border);
	const shadow = rawShadows(record.shadow);
	const filter = rawFilters(record.filter);
	if (corner) style.round_corner = corner;
	if (border) style.border = border;
	if (shadow) style.shadow = shadow;
	if (filter) style.filter = filter;
}
function applyResolvedStyle(style, entry, isText, ctx) {
	for (const layer of [...styleLayers(entry)].reverse()) {
		applyRawStyleRecord(style, layer, isText, ctx);
		applyTextRecord(style, layer);
	}
	const fills = recordArrayField(entry, [
		"fills",
		"fillPaints",
		"paints"
	]);
	const solid = fills.find((paint) => visiblePaint(paint) && paintType(paint) === "solid");
	const gradient = fills.find((paint) => visiblePaint(paint) && paintType(paint)?.includes("gradient"));
	const color = solid ? paintColor(solid) : void 0;
	const background = gradient ? rawGradient(gradient) : void 0;
	if (color) if (isText) style.font_color = color;
	else style.background_color = color;
	else if (background && !isText) style.background_color = background;
	for (const text of recordArrayField(entry, [
		"text",
		"textStyle",
		"typography"
	])) applyTextRecord(style, text);
}
function expandedStyleRecords(node, key, aliases, ctx) {
	const result = [];
	for (const value of effectiveArray(node, key)) {
		const reference = styleReference(value);
		if (!reference) {
			if (isRecord$3(value)) result.push(value);
			continue;
		}
		const entry = resolvedStyle(reference, ctx);
		if (!entry) continue;
		const records = recordArrayField(entry, aliases);
		if (records.length > 0) result.push(...records);
		else if (paintType(entry) !== void 0) result.push(entry);
	}
	return result;
}
var VECTOR_RESOURCE_TYPES = new Set([
	"VECTOR",
	"BOOLEAN_OPERATION",
	"LINE",
	"POLYGON",
	"STAR"
]);
var ICON_FONT_FAMILIES$2 = new Set([
	"HM Symbol",
	"Material Icons",
	"Material Symbols",
	"iconfont",
	"icomoon",
	"Font Awesome"
]);
function isMaskNode(node) {
	return node.type === "MASK" || effectiveField(node, "mask") === true;
}
function hasVisibleMaskChild(node) {
	return (Array.isArray(node.children) ? node.children : []).some((child) => effectiveField(child, "visible") !== false && isMaskNode(child));
}
function resolvedFontFamily(node, ctx) {
	let inherited;
	for (const reference of nodeStyleReferences(node)) {
		const entry = resolvedStyle(reference, ctx);
		if (!entry) continue;
		for (const layer of [...styleLayers(entry)].reverse()) inherited = nonEmptyString$2(layer.fontFamily ?? layer.font_family) ?? inherited;
		for (const text of recordArrayField(entry, [
			"text",
			"textStyle",
			"typography"
		])) inherited = nonEmptyString$2(text.fontFamily ?? text.font_family) ?? inherited;
	}
	const text = effectiveRecord(node, "text");
	return nonEmptyString$2(text?.fontFamily ?? text?.font_family) ?? inherited;
}
function requestCompositeOwner(node, ancestors, pageRoot, path, reasons, ctx) {
	if (reasons.length === 0) return;
	const owner = [node, ...[...ancestors].reverse()].find((candidate) => candidate !== pageRoot && sourceId(candidate) !== void 0);
	if (!owner) {
		const existing = ctx.unownedResources.get(node) ?? {
			path,
			reasons: /* @__PURE__ */ new Set()
		};
		reasons.forEach((reason) => existing.reasons.add(reason));
		ctx.unownedResources.set(node, existing);
		return;
	}
	const ownerId = sourceId(owner);
	const plan = ctx.compositeOwners.get(owner) ?? {
		ownerId,
		reasons: /* @__PURE__ */ new Set(),
		sourcePaths: /* @__PURE__ */ new Set()
	};
	reasons.forEach((reason) => plan.reasons.add(reason));
	plan.sourcePaths.add(path);
	ctx.compositeOwners.set(owner, plan);
}
function planResourceOwners(roots, hydrationIssues, ctx) {
	const hydrationReasons = /* @__PURE__ */ new Map();
	for (const issue of hydrationIssues) {
		const reasons = hydrationReasons.get(issue.node) ?? [];
		reasons.push(`hydration-${issue.code}`);
		hydrationReasons.set(issue.node, reasons);
	}
	const visit = (node, ancestors, pageRoot, path) => {
		if (effectiveField(node, "visible") === false) return;
		for (const reference of nodeStyleReferences(node)) resolvedStyle(reference, ctx);
		const fills = expandedStyleRecords(node, "fills", [
			"fills",
			"fillPaints",
			"paints"
		], ctx);
		const strokes = expandedStyleRecords(node, "strokes", ["strokes", "strokePaints"], ctx);
		const visibleFills = fills.filter(visiblePaint);
		const visibleStrokes = strokes.filter(visiblePaint);
		const complexReasons = [...hydrationReasons.get(node) ?? []];
		const occurrenceProfile = ctx.options.occurrenceDslProfile === true;
		const angle = finiteNumber$2(effectiveField(node, "angle"));
		if (!occurrenceProfile && angle !== void 0 && angle !== 0) complexReasons.push("rotation");
		if (!occurrenceProfile && effectiveField(node, "showMask") === true) complexReasons.push("show-mask");
		if (hasVisibleMaskChild(node)) complexReasons.push("mask-composition");
		if (isMaskNode(node) && ancestors.length === 0) complexReasons.push("root-mask");
		if (!occurrenceProfile && visibleFills.length > 1) complexReasons.push("multiple-fills");
		if (!occurrenceProfile && visibleStrokes.length > 1) complexReasons.push("multiple-strokes");
		const blendMode = nonEmptyString$2(effectiveField(node, "blendMode"))?.toUpperCase();
		if (blendMode && blendMode !== "NORMAL" && blendMode !== "PASS_THROUGH") complexReasons.push("blend-mode");
		if (visibleFills.some((paint) => paintType(paint)?.includes("gradient") === true && Array.isArray(paint.transform) && !Array.isArray(paint.points))) complexReasons.push("unresolved-gradient-transform");
		requestCompositeOwner(node, ancestors, pageRoot, path, complexReasons, ctx);
		if (!sourceId(node)) {
			const resourceReasons = [];
			if (visibleFills.some((paint) => {
				const type = paintType(paint);
				return type === "asset" || type === "image";
			})) resourceReasons.push("idless-bitmap");
			const vectorRefValue = nonEmptyString$2(effectiveField(node, "vectorRef"));
			if (occurrenceProfile ? VECTOR_RESOURCE_TYPES.has(node.type) && vectorRefValue === void 0 : VECTOR_RESOURCE_TYPES.has(node.type) || vectorRefValue !== void 0) resourceReasons.push("idless-vector");
			if ((node.type === "TEXT" || node.type === "PARAGRAPH") && ICON_FONT_FAMILIES$2.has(resolvedFontFamily(node, ctx) ?? "")) resourceReasons.push("idless-icon-font");
			requestCompositeOwner(node, ancestors, pageRoot, path, resourceReasons, ctx);
		}
		(Array.isArray(node.children) ? node.children : []).forEach((child, sourceIndex) => visit(child, [...ancestors, node], pageRoot, `${path}.${sourceIndex}`));
	};
	roots.forEach((root, rootIndex) => visit(root, [], root, `root.${rootIndex}`));
	ctx.resourceDiagnostics = [...ctx.unownedResources.entries()].map(([node, plan]) => ({
		code: "missing-resource-owner",
		path: plan.path,
		source_type: node.type,
		reasons: [...plan.reasons],
		...sourceId(node) ? { node_id: sourceId(node) } : {}
	}));
}
function defaultAssetPath(assetId, paint) {
	const extension = nonEmptyString$2(paint.name)?.match(/\.[a-z0-9]+$/i)?.[0] ?? ".png";
	return `assets/pixso/asset-${encodePathPart(assetId)}${extension}`;
}
function assetPath(paint, ctx) {
	const direct = nonEmptyString$2(paint.url ?? paint.src ?? paint.path);
	if (direct) return direct;
	const id = nonEmptyString$2(paint.id ?? paint.hash ?? paint.assetId ?? paint.value);
	if (!id) return void 0;
	return ctx.options.assetPathForId?.(id, paint) ?? defaultAssetPath(id, paint);
}
function applyFills(style, fills, isText, ctx) {
	const visible = fills.filter(visiblePaint);
	const solid = visible.find((paint) => paintType(paint) === "solid");
	const gradient = visible.find((paint) => paintType(paint)?.includes("gradient"));
	const color = solid ? paintColor(solid) : void 0;
	const background = gradient ? rawGradient(gradient) : void 0;
	if (color) if (isText) style.font_color = color;
	else style.background_color = color;
	else if (background && !isText) style.background_color = background;
	if (isText) return {};
	const asset = visible.find((paint) => paintType(paint) === "asset" || paintType(paint) === "image");
	if (!asset) return {};
	const path = assetPath(asset, ctx);
	if (!path) return { asset };
	style.background_image = assetReference$1(path, ctx);
	style.background_position = "center";
	style.background_repeat = "no-repeat";
	const scaleMode = nonEmptyString$2(asset.imageScaleMode ?? asset.scaleMode)?.toUpperCase();
	style.background_size = scaleMode === "FIT" ? "contain" : scaleMode === "STRETCH" ? "100% 100%" : "cover";
	return {
		asset,
		assetPath: path
	};
}
function applyStrokes(style, strokes, node) {
	const solid = strokes.find((paint) => visiblePaint(paint) && paintType(paint) === "solid");
	const color = solid ? paintColor(solid) : void 0;
	const width = finiteNonNegative(effectiveField(node, "strokeWeight"));
	if (!color || width === void 0 || width === 0) return;
	style.border = [
		"top",
		"right",
		"bottom",
		"left"
	].map((position) => ({
		position,
		style: "solid",
		width,
		color
	}));
}
function effectOffset(value) {
	if (Array.isArray(value)) return {
		x: finiteNumber$2(value[0]) ?? 0,
		y: finiteNumber$2(value[1]) ?? 0
	};
	if (isRecord$3(value)) return {
		x: finiteNumber$2(value.x) ?? 0,
		y: finiteNumber$2(value.y) ?? 0
	};
	return {
		x: 0,
		y: 0
	};
}
function applyEffects(style, effects) {
	const shadows = [];
	const filters = [];
	for (const effect of effects) {
		if (effect.visible === false) continue;
		const type = nonEmptyString$2(effect.type)?.toUpperCase() ?? "";
		if (type === "DROP_SHADOW" || type === "INNER_SHADOW") {
			const color = rawColor(effect.color);
			if (!color) continue;
			const offset = effectOffset(effect.offset);
			shadows.push({
				type: type === "INNER_SHADOW" ? "inner" : "outer",
				color,
				x: offset.x,
				y: offset.y,
				blur: Math.max(0, finiteNumber$2(effect.radius ?? effect.blur) ?? 0),
				...finiteNumber$2(effect.spread) !== void 0 ? { spread: finiteNumber$2(effect.spread) } : {}
			});
		} else if (type === "BACKGROUND_BLUR" || type === "FOREGROUND_BLUR" || type === "LAYER_BLUR") {
			const value = finiteNonNegative(effect.radius ?? effect.value);
			if (value !== void 0) filters.push({
				type: type === "BACKGROUND_BLUR" ? "background" : "layer",
				value
			});
		}
	}
	if (shadows.length > 0) style.shadow = shadows;
	if (filters.length > 0) style.filter = filters;
}
function buildRawStyle(node, width, height, ctx) {
	const isText = node.type === "TEXT" || node.type === "PARAGRAPH";
	const style = {
		origin_width: width,
		origin_height: height
	};
	const references = nodeStyleReferences(node);
	for (const reference of references) {
		const entry = resolvedStyle(reference, ctx);
		if (entry) applyResolvedStyle(style, entry, isText, ctx);
	}
	const directRawStyle = effectiveRecord(node, "style");
	if (directRawStyle) applyRawStyleRecord(style, directRawStyle, isText, ctx);
	const fills = expandedStyleRecords(node, "fills", [
		"fills",
		"fillPaints",
		"paints"
	], ctx);
	const strokes = expandedStyleRecords(node, "strokes", ["strokes", "strokePaints"], ctx);
	const effects = expandedStyleRecords(node, "effects", ["effects", "effectiveEffects"], ctx);
	const asset = applyFills(style, fills, isText, ctx);
	applyStrokes(style, strokes, node);
	applyEffects(style, effects);
	const text = effectiveRecord(node, "text");
	if (text) applyTextRecord(style, text);
	if (isText) applyTextStyleMetadataFallback(style, node, ctx);
	const opacity = finiteNumber$2(effectiveField(node, "opacity"));
	const rotation = finiteNumber$2(effectiveField(node, "angle"));
	const corner = rawCorner(effectiveField(node, "radius"));
	if (opacity !== void 0) style.opacity = Math.max(0, Math.min(1, opacity));
	if (rotation !== void 0) style.rotation_angle = rotation;
	if (corner) style.round_corner = corner;
	return {
		style,
		...asset
	};
}
function normalizeAlign$1(value) {
	if (typeof value !== "string") return void 0;
	const normalized = value.trim().toUpperCase().replace(/[ -]+/g, "_");
	if (normalized === "START" || normalized === "FLEX_START" || normalized === "LEFT" || normalized === "TOP") return "MIN";
	if (normalized === "END" || normalized === "FLEX_END" || normalized === "RIGHT" || normalized === "BOTTOM") return "MAX";
	return normalized === "MIN" || normalized === "CENTER" || normalized === "MAX" || normalized === "SPACE_BETWEEN" || normalized === "BASELINE" ? normalized : void 0;
}
function layoutPadding(value) {
	const uniform = finiteNumber$2(value);
	if (uniform !== void 0) return {
		top: uniform,
		right: uniform,
		bottom: uniform,
		left: uniform
	};
	if (Array.isArray(value) && value.length === 4) {
		const values = value.map(finiteNumber$2);
		if (values.every((entry) => entry !== void 0)) return {
			top: values[0],
			right: values[1],
			bottom: values[2],
			left: values[3]
		};
	}
	if (!isRecord$3(value)) return void 0;
	const top = finiteNumber$2(value.top);
	const right = finiteNumber$2(value.right);
	const bottom = finiteNumber$2(value.bottom);
	const left = finiteNumber$2(value.left);
	if ([
		top,
		right,
		bottom,
		left
	].every((entry) => entry === void 0)) return void 0;
	return {
		top: top ?? 0,
		right: right ?? 0,
		bottom: bottom ?? 0,
		left: left ?? 0
	};
}
function designLayout$1(node) {
	const source = effectiveRecord(node, "autoLayout");
	if (!source) return void 0;
	const rawMode = nonEmptyString$2(source.mode ?? source.direction ?? source.stackMode)?.toUpperCase();
	const mode = rawMode === "HORIZONTAL" || rawMode === "VERTICAL" || rawMode === "NONE" ? rawMode : void 0;
	const primaryAxisAlign = mode === "HORIZONTAL" ? source.itemHoriAlign : source.itemVertAlign;
	const counterAxisAlign = mode === "HORIZONTAL" ? source.itemVertAlign : source.itemHoriAlign;
	const result = {};
	if (mode) result.stackMode = mode;
	const primary = normalizeAlign$1(source.primaryAlign ?? source.align ?? primaryAxisAlign);
	const counter = normalizeAlign$1(source.counterAlign ?? counterAxisAlign);
	if (primary) result.stackPrimaryAlignItems = primary;
	if (counter) result.stackCounterAlignItems = counter;
	const gap = finiteNumber$2(source.gap ?? source.stackSpacing ?? source.autoLayoutItemSpacing);
	if (gap !== void 0) result.stackSpacing = gap;
	const padding = layoutPadding(source.padding);
	if (padding) {
		result.stackPaddingTop = padding.top;
		result.stackPaddingRight = padding.right;
		result.stackPaddingBottom = padding.bottom;
		result.stackPaddingLeft = padding.left;
	}
	for (const [target, candidates] of [
		["stackPrimarySizing", [
			"primarySizing",
			"stackPrimarySizing",
			"widthResize"
		]],
		["stackCounterSizing", [
			"counterSizing",
			"stackCounterSizing",
			"heightResize"
		]],
		["stackChildPrimarySizing", ["childPrimarySizing", "stackChildPrimarySizing"]],
		["stackChildCounterSizing", ["childCounterSizing", "stackChildCounterSizing"]]
	]) {
		const value = candidates.map((key) => nonEmptyString$2(source[key])).find(Boolean);
		if (value) result[target] = value.toUpperCase();
	}
	if (source.absolute === true || source.autoLayoutAbsolutePos === true || source.autoLayoutItemAbsolutePos === true) result.autoLayoutAbsolutePos = true;
	if (source.wrap === true || String(source.wrap).toUpperCase() === "WRAP" || source.stackWrap === "WRAP") result.stackWrap = "WRAP";
	else if (source.wrap === false || source.stackWrap === "NO_WRAP") result.stackWrap = "NO_WRAP";
	return Object.keys(result).length > 0 ? JSON.stringify(result) : void 0;
}
function collectComponentMetadata(input) {
	const result = /* @__PURE__ */ new Map();
	const add = (entry) => {
		if (!isRecord$3(entry)) return;
		const id = nonEmptyString$2(entry.id);
		if (id) result.set(id, entry);
	};
	for (const entry of Array.isArray(input.refsIndex.components) ? input.refsIndex.components : []) add(entry);
	for (const set of Array.isArray(input.refsIndex.componentSets) ? input.refsIndex.componentSets : []) {
		add(set);
		for (const variant of Array.isArray(set.variants) ? set.variants : []) add(variant);
	}
	return result;
}
function componentInstance(node, key, ctx) {
	if (node.type !== "INSTANCE") return void 0;
	const componentRef = nonEmptyString$2(effectiveField(node, "componentRef"));
	const metadata = componentRef ? ctx.componentMetadata.get(componentRef) : void 0;
	const componentKey = nonEmptyString$2(metadata?.componentKey) ?? nonEmptyString$2(effectiveField(node, "componentKey"));
	const instanceName = nonEmptyString$2(node.name) ?? key;
	const componentName = nonEmptyString$2(metadata?.name);
	return {
		...componentKey ? { component_key: componentKey } : {},
		...componentName ? { component_name: componentName } : {},
		...componentRef ? { symbol_key: componentRef } : {},
		instance_name: instanceName
	};
}
function masterDimensions(node, input) {
	const componentRef = node.type === "INSTANCE" ? nonEmptyString$2(effectiveField(node, "componentRef")) : void 0;
	const master = componentRef ? input.resolvedRefs?.componentRoots?.[componentRef] : void 0;
	const masterBox = master ? effectiveBox(master) : {};
	const box = effectiveBox(node);
	return {
		width: finiteNonNegative(box.w ?? box.width) ?? finiteNonNegative(masterBox.w ?? masterBox.width),
		height: finiteNonNegative(box.h ?? box.height) ?? finiteNonNegative(masterBox.h ?? masterBox.height)
	};
}
function libraryStyle(references, ctx) {
	const result = [];
	for (const reference of references) {
		let metadata;
		let resolved;
		for (const alias of styleAliases(reference)) {
			metadata ??= ctx.styles.metadata.get(alias);
			resolved ??= ctx.styles.entries.get(alias);
		}
		const source = metadata ?? resolved;
		const styleKey = nonEmptyString$2(source?.style_key) ?? styleAliases(reference)[0];
		const styleName = nonEmptyString$2(source?.style_name ?? source?.name);
		const styleType = nonEmptyString$2(source?.style_type ?? source?.category);
		const styleValue = isRecord$3(resolved?.style_value) ? resolved.style_value : void 0;
		result.push({
			style_key: styleKey,
			...styleName ? { style_name: styleName } : {},
			...styleType ? { style_type: styleType } : {},
			...styleValue ? { style_value: styleValue } : {},
			resolved: resolved !== void 0
		});
	}
	return result.length > 0 ? result : void 0;
}
function normalizeNodeType$1(node, suppressUnownedResource = false) {
	if (node.type === "INSTANCE") return "FRAME";
	if (node.type === "PARAGRAPH") return "TEXT";
	if (node.type === "SYMBOL") return "COMPONENT";
	if (suppressUnownedResource && (VECTOR_RESOURCE_TYPES.has(node.type) || node.type === "IMAGE")) return "FRAME";
	return node.type;
}
function occurrenceAssetPath(ownerId) {
	return `assets/${ownerId.replace(/[^A-Za-z0-9._-]/g, "_")}.png`;
}
function convertNode$2(node, parentX, parentY, rootScope, path, ctx, insideInstance = false) {
	const key = nodeKey(node, rootScope, path);
	const box = effectiveBox(node);
	const x = parentX + (finiteNumber$2(box.x ?? box.left) ?? 0);
	const y = parentY + (finiteNumber$2(box.y ?? box.top) ?? 0);
	const dimensions = masterDimensions(node, ctx.input);
	const width = dimensions.width ?? 0;
	const height = dimensions.height ?? 0;
	const compositePlan = ctx.compositeOwners.get(node);
	const unownedPlan = ctx.unownedResources.get(node);
	const builtStyle = compositePlan ? { style: {
		origin_width: width,
		origin_height: height
	} } : buildRawStyle(node, width, height, ctx);
	if (unownedPlan) {
		delete builtStyle.style.background_image;
		delete builtStyle.style.background_position;
		delete builtStyle.style.background_repeat;
		delete builtStyle.style.background_size;
		if (ICON_FONT_FAMILIES$2.has(builtStyle.style.font_family ?? "")) delete builtStyle.style.font_family;
	}
	if (compositePlan) {
		ctx.emittedCompositeOwners.add(node);
		builtStyle.style.background_image = assetReference$1(occurrenceAssetPath(compositePlan.ownerId), ctx);
		builtStyle.style.background_position = "center";
		builtStyle.style.background_repeat = "no-repeat";
		builtStyle.style.background_size = "100% 100%";
	}
	const styleReferences = nodeStyleReferences(node);
	const assetId = builtStyle.asset ? nonEmptyString$2(builtStyle.asset.id ?? builtStyle.asset.hash ?? builtStyle.asset.assetId) : void 0;
	const pixso = {
		source_format: "refs",
		source_type: node.type,
		...sourceId(node) ? { guid: sourceId(node) } : { synthetic_id: key },
		...nonEmptyString$2(effectiveField(node, "componentRef")) ? { component_ref: nonEmptyString$2(effectiveField(node, "componentRef")) } : {},
		...nonEmptyString$2(effectiveField(node, "componentNodeRef")) ? { component_node_ref: nonEmptyString$2(effectiveField(node, "componentNodeRef")) } : {},
		...nonEmptyString$2(effectiveField(node, "componentSetRef")) ? { component_set_ref: nonEmptyString$2(effectiveField(node, "componentSetRef")) } : {},
		...nonEmptyString$2(effectiveField(node, "vectorRef")) ? { vector_ref: nonEmptyString$2(effectiveField(node, "vectorRef")) } : {},
		...styleReferences.length > 0 ? { style_refs: styleReferences } : {},
		...assetId ? { asset_refs: [assetId] } : {},
		...builtStyle.assetPath ? { image_asset: builtStyle.assetPath } : {},
		...compositePlan ? {
			composite_reasons: [...compositePlan.reasons],
			composite_source_paths: [...compositePlan.sourcePaths],
			occurrence_asset: occurrenceAssetPath(compositePlan.ownerId)
		} : {},
		...unownedPlan ? { unmaterialized_resource_reasons: [...unownedPlan.reasons] } : {},
		source: shallowSource(node)
	};
	const extend = { pixso };
	const layout = designLayout$1(node);
	if (layout) extend.design_layout = layout;
	const vectorRef = nonEmptyString$2(effectiveField(node, "vectorRef"));
	if (vectorRef && !compositePlan && !unownedPlan) {
		extend.vector_shape = vectorRef;
		if (ctx.options.occurrenceDslProfile === true) {
			if (!builtStyle.style.background_image) builtStyle.style.background_image = assetReference$1(`assets/pixso/vector-${encodePathPart(vectorRef)}`, ctx);
			if (!sourceId(node)) pixso.guid = vectorRef;
		}
	}
	if (isMaskNode(node)) {
		extend.mask = true;
		pixso.mask = true;
	}
	const visibleChildren = (Array.isArray(node.children) ? node.children : []).map((child, sourceIndex) => ({
		child,
		sourceIndex
	})).filter(({ child }) => effectiveField(child, "visible") !== false);
	const orderedChildren = ctx.options.occurrenceDslProfile === true && insideInstance ? visibleChildren : [...visibleChildren].reverse();
	const childrenInsideInstance = insideInstance || node.type === "INSTANCE";
	const children = compositePlan ? [] : orderedChildren.map(({ child, sourceIndex }) => convertNode$2(child, x, y, rootScope, `${path}.${sourceIndex}`, ctx, childrenInsideInstance));
	if (compositePlan) {
		extend.image_role = "content";
		extend.image_source = "composite";
		extend.image_opaque = false;
	} else if (builtStyle.style.background_image) {
		extend.image_role = children.length > 0 ? "background" : "content";
		extend.image_source = "raster";
		extend.image_opaque = false;
	}
	const raw = {
		key,
		name: nonEmptyString$2(node.name) ?? sourceId(node) ?? node.type,
		type: unownedPlan?.reasons.has("idless-icon-font") ? "FRAME" : normalizeNodeType$1(node, unownedPlan !== void 0),
		box: {
			x,
			y,
			width,
			height
		},
		style: builtStyle.style,
		extend
	};
	const text = effectiveRecord(node, "text");
	if (raw.type === "TEXT" && typeof text?.content === "string") raw.content = text.content;
	const instance = componentInstance(node, key, ctx);
	if (instance) raw.component_instance = instance;
	if (children.length > 0) raw.children = children;
	const styles = libraryStyle(styleReferences, ctx);
	if (styles) raw.library_style = styles;
	return raw;
}
function unionRoot$1(nodes) {
	const minX = Math.min(...nodes.map((node) => node.box.x));
	const minY = Math.min(...nodes.map((node) => node.box.y));
	const maxX = Math.max(...nodes.map((node) => node.box.x + node.box.width));
	const maxY = Math.max(...nodes.map((node) => node.box.y + node.box.height));
	const width = maxX - minX;
	const height = maxY - minY;
	return {
		key: "pixso:refs:synthetic:root",
		name: "Pixso Design",
		type: "FRAME",
		box: {
			x: minX,
			y: minY,
			width,
			height
		},
		style: {
			origin_width: width,
			origin_height: height
		},
		extend: { pixso: {
			source_format: "refs",
			source_type: "FRAME",
			synthetic_root: true,
			synthetic_id: "pixso:refs:synthetic:root"
		} },
		children: [...nodes].reverse()
	};
}
/**
* Materializes compact Pixso refs data into the same RawNewRoot contract used
* by the existing layout pipeline. Component masters are hydrated first, but
* master ids remain provenance and never become page occurrence ids.
*/
function convertPixsoRefsToRawNewRoot(input, options = {}) {
	if (!isPixsoRefsRoot(input)) throw new Error("convertPixsoRefsToRawNewRoot: 输入不是有效的 Pixso refs 设计数据");
	if (options === null || typeof options !== "object" || Array.isArray(options)) throw new TypeError("convertPixsoRefsToRawNewRoot: options 必须是对象");
	const hydration = hydratePixsoRefsRoots(input, { occurrenceDriven: options.occurrenceDslProfile === true });
	if (options.strict === true && hydration.issues.length > 0) {
		const details = hydration.issues.map((issue) => `${issue.code}:${sourceId(issue.node) ?? issue.path}[${issue.componentRef ?? "-"}]`).join(", ");
		throw new Error(`convertPixsoRefsToRawNewRoot: component hydration failed: ${details}`);
	}
	const ctx = {
		input: {
			roots: hydration.roots,
			refsIndex: input.refsIndex,
			...input.stats !== void 0 ? { stats: input.stats } : {},
			...input.resolvedRefs !== void 0 ? { resolvedRefs: input.resolvedRefs } : {}
		},
		options,
		assets: [],
		assetIndexes: /* @__PURE__ */ new Map(),
		componentMetadata: collectComponentMetadata(input),
		styles: createStyleResolver(input),
		usedStyleRefs: /* @__PURE__ */ new Set(),
		unresolvedStyleRefs: /* @__PURE__ */ new Set(),
		compositeOwners: /* @__PURE__ */ new Map(),
		emittedCompositeOwners: /* @__PURE__ */ new Set(),
		unownedResources: /* @__PURE__ */ new Map(),
		resourceDiagnostics: []
	};
	planResourceOwners(hydration.roots, hydration.issues, ctx);
	if (options.strict === true && ctx.resourceDiagnostics.length > 0) {
		const details = ctx.resourceDiagnostics.map((diagnostic) => `${diagnostic.path}[${diagnostic.reasons.join(",")}]`).join(", ");
		throw new Error(`convertPixsoRefsToRawNewRoot: resource owner resolution failed: ${details}`);
	}
	if (options.strict === true && options.allowUnresolvedStyles !== true && ctx.unresolvedStyleRefs.size > 0) throw new Error(`convertPixsoRefsToRawNewRoot: unresolved style references: ${[...ctx.unresolvedStyleRefs].join(", ")}`);
	const roots = hydration.roots.map((root, sourceIndex) => ({
		root,
		sourceIndex
	})).filter(({ root }) => effectiveField(root, "visible") !== false).map(({ root, sourceIndex }) => convertNode$2(root, 0, 0, sourceId(root) ?? `root-${sourceIndex}`, `root.${sourceIndex}`, ctx));
	if (roots.length === 0) throw new Error("convertPixsoRefsToRawNewRoot: roots 没有可见节点");
	const root = roots.length === 1 ? roots[0] : unionRoot$1(roots);
	return {
		assets: ctx.assets,
		content: [root],
		meta: {
			source: "pixso-refs",
			name: root.name,
			hydration_issues: hydration.issues.map((issue) => ({
				code: issue.code,
				path: issue.path,
				...sourceId(issue.node) ? { node_id: sourceId(issue.node) } : {},
				...issue.componentRef ? { component_ref: issue.componentRef } : {}
			})),
			style_refs: [...ctx.usedStyleRefs],
			unresolved_style_refs: [...ctx.unresolvedStyleRefs],
			resource_owners: [...ctx.emittedCompositeOwners].map((node) => {
				const plan = ctx.compositeOwners.get(node);
				return {
					owner_id: plan.ownerId,
					reasons: [...plan.reasons],
					source_paths: [...plan.sourcePaths]
				};
			}),
			resource_diagnostics: ctx.resourceDiagnostics
		}
	};
}
//#endregion
//#region src/parsers/pixso/pixso-master-archive.ts
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmptyString$1(value) {
	return typeof value === "string" && value.trim().length > 0 ? value : void 0;
}
function finiteNumber$1(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function styleReferenceKey(value) {
	const styleKey = nonEmptyString$1(value.styleKey);
	if (!styleKey) return void 0;
	const versionHash = nonEmptyString$1(value.versionHash);
	return versionHash ? `${styleKey}/${versionHash}` : styleKey;
}
function buildStyleIndex(localStyleMap) {
	const index = /* @__PURE__ */ new Map();
	if (!isRecord$2(localStyleMap)) return index;
	for (const [guid, value] of Object.entries(localStyleMap)) {
		if (!isRecord$2(value)) continue;
		const key = styleReferenceKey(value);
		if (key) index.set(guid, { reference: `style:${key}` });
	}
	return index;
}
var TEXT_STYLE_FIELDS = [
	"fontFamily",
	"fontStyle",
	"fontSize",
	"fontWeight",
	"lineHeight",
	"letterSpacing",
	"letterSpacingUnit",
	"textAlignHorizontal",
	"textAlignVertical"
];
function adaptStyles(localStyleMap) {
	const styles = {};
	if (!isRecord$2(localStyleMap)) return styles;
	for (const value of Object.values(localStyleMap)) {
		if (!isRecord$2(value)) continue;
		const key = styleReferenceKey(value);
		if (!key || styles[key] !== void 0) continue;
		const entry = { ...value };
		if (nonEmptyString$1(value.styleType)?.toUpperCase() === "TEXT" && !isRecord$2(value.text)) {
			const text = {};
			for (const field of TEXT_STYLE_FIELDS) if (value[field] !== void 0) text[field] = value[field];
			if (Object.keys(text).length > 0) entry.text = text;
		}
		styles[key] = entry;
	}
	return styles;
}
function adaptPaint(paint) {
	if (nonEmptyString$1(paint.type)?.toUpperCase() === "IMAGE") {
		const image = isRecord$2(paint.image) ? paint.image : {};
		const adapted = {
			...paint,
			type: "asset"
		};
		delete adapted.image;
		const hash = nonEmptyString$1(image.hash);
		if (hash) adapted.id = hash;
		const name = nonEmptyString$1(image.name);
		if (name) adapted.name = name;
		return adapted;
	}
	return { ...paint };
}
function adaptPaintList(value) {
	if (!Array.isArray(value)) return void 0;
	const adapted = value.filter(isRecord$2).map(adaptPaint);
	return adapted.length > 0 ? adapted : void 0;
}
function adaptFills(node, styleIndex) {
	const inherit = nonEmptyString$1(node.inheritFillStyleID);
	const reference = inherit ? styleIndex.get(inherit)?.reference : void 0;
	if (reference) return [reference];
	return adaptPaintList(node.fillPaints);
}
var TEXT_NODE_FIELDS = [
	...TEXT_STYLE_FIELDS,
	"textDecoration",
	"textCase",
	"textTruncation",
	"maxLines"
];
function adaptText(node, styleIndex) {
	const type = nonEmptyString$1(node.type)?.toUpperCase();
	if (type !== "TEXT" && type !== "PARAGRAPH") return void 0;
	const text = {};
	const content = node.nodeText;
	if (typeof content === "string") text.content = content;
	for (const field of TEXT_NODE_FIELDS) if (node[field] !== void 0) text[field] = node[field];
	const autoResize = nonEmptyString$1(node.textAutoResize);
	if (autoResize) text.autoResize = autoResize;
	const inherit = nonEmptyString$1(node.inheritTextStyleID);
	const reference = inherit ? styleIndex.get(inherit)?.reference : void 0;
	if (reference) text.style = reference;
	return Object.keys(text).length > 0 ? text : void 0;
}
function adaptAutoLayout(value) {
	if (!isRecord$2(value)) return void 0;
	const adapted = { ...value };
	const top = finiteNumber$1(value.autoLayoutPaddingTop);
	const right = finiteNumber$1(value.autoLayoutPaddingRight);
	const bottom = finiteNumber$1(value.autoLayoutPaddingBottom);
	const left = finiteNumber$1(value.autoLayoutPaddingLeft);
	if (!isRecord$2(value.padding) && [
		top,
		right,
		bottom,
		left
	].some((entry) => entry !== void 0)) adapted.padding = {
		top: top ?? 0,
		right: right ?? 0,
		bottom: bottom ?? 0,
		left: left ?? 0
	};
	if (adapted.primaryAlign === void 0 && value.autoLayoutPrimaryAlign !== void 0) adapted.primaryAlign = value.autoLayoutPrimaryAlign;
	if (adapted.counterAlign === void 0 && value.autoLayoutCounterAlign !== void 0) adapted.counterAlign = value.autoLayoutCounterAlign;
	if (adapted.counterGap === void 0 && value.autoLayoutCounterItemSpacing !== void 0) adapted.counterGap = value.autoLayoutCounterItemSpacing;
	return adapted;
}
function adaptBox(node) {
	const box = {};
	const w = finiteNumber$1(node.width);
	const h = finiteNumber$1(node.height);
	const x = finiteNumber$1(node.left);
	const y = finiteNumber$1(node.top);
	if (w !== void 0) box.w = w;
	if (h !== void 0) box.h = h;
	if (x !== void 0) box.x = x;
	if (y !== void 0) box.y = y;
	return Object.keys(box).length > 0 ? box : void 0;
}
/** 身份/几何/样式之外原样透传的字段（refs 消费端认识或安全忽略）。 */
var PASSTHROUGH_FIELDS = [
	"visible",
	"angle",
	"blendMode",
	"opacity",
	"strokeWeight",
	"effects",
	"componentKey",
	"frameMaskDisabled",
	"showMask"
];
function structuralChildren$1(node) {
	return Array.isArray(node.childNode) ? node.childNode.filter(isRecord$2) : [];
}
function adaptMasterNode(node, styleIndex) {
	const guid = nonEmptyString$1(node.guid);
	const type = nonEmptyString$1(node.type);
	if (!guid || !type) return void 0;
	const adapted = {
		id: guid,
		type
	};
	const name = nonEmptyString$1(node.name);
	if (name) adapted.name = name;
	const box = adaptBox(node);
	if (box) adapted.box = box;
	for (const field of PASSTHROUGH_FIELDS) if (node[field] !== void 0) adapted[field] = node[field];
	const radius = node.cornerRadius ?? node.radius;
	if (radius !== void 0) adapted.radius = radius;
	const horizontal = nonEmptyString$1(node.horizontalConstraint);
	const vertical = nonEmptyString$1(node.verticalConstraint);
	if (horizontal || vertical) adapted.constraints = {
		...horizontal ? { horizontal } : {},
		...vertical ? { vertical } : {}
	};
	if (type === "INSTANCE") {
		const componentRef = nonEmptyString$1(node.mainComponent);
		if (componentRef) adapted.componentRef = componentRef;
		const componentSetRef = nonEmptyString$1(node.mainStateGroup);
		if (componentSetRef) adapted.componentSetRef = componentSetRef;
	}
	const fills = adaptFills(node, styleIndex);
	if (fills) adapted.fills = fills;
	const strokes = adaptPaintList(node.strokePaints);
	if (strokes) adapted.strokes = strokes;
	const text = adaptText(node, styleIndex);
	if (text) adapted.text = text;
	const layout = adaptAutoLayout(node.autoLayout);
	if (layout) adapted.autoLayout = layout;
	const children = structuralChildren$1(node);
	if (nonEmptyString$1(node.svgSha)) {
		adapted.vectorRef = guid;
		adapted.assetType = "icon";
		if (children.length > 0) adapted.childrenSummary = {
			total: children.length,
			omitted: children.length,
			reason: "vector-icon"
		};
		return adapted;
	}
	if (children.length > 0) adapted.children = [...children].reverse().map((child) => adaptMasterNode(child, styleIndex)).filter((child) => child !== void 0);
	return adapted;
}
function registerComponentRoots(node, componentRoots) {
	const id = nonEmptyString$1(node.id);
	if (id && componentRoots[id] === void 0) componentRoots[id] = node;
	for (const child of Array.isArray(node.children) ? node.children : []) registerComponentRoots(child, componentRoots);
}
/** 判断物化节点是否是同父下某个无 id stub 的替代（同类型同名 + 组件引用同源）。 */
function materializedReplacesStub(stub, materialized) {
	if (stub.type !== materialized.type) return false;
	if (nonEmptyString$1(stub.name) !== nonEmptyString$1(materialized.name)) return false;
	const stubSet = nonEmptyString$1(stub.componentSetRef);
	const materializedSet = nonEmptyString$1(materialized.componentSetRef);
	if (stubSet && materializedSet) return stubSet === materializedSet;
	const stubRef = nonEmptyString$1(stub.componentRef);
	const materializedRef = nonEmptyString$1(materialized.componentRef);
	if (stubRef && materializedRef) return stubRef === materializedRef;
	const slot = nonEmptyString$1(materialized.componentNodeRef);
	return slot !== void 0 && slot === nonEmptyString$1(stub.componentNodeRef);
}
/**
* occurrence 树预处理：simplify=true 返回里，被 override 物化的实例会以带 id 节点
* 的形式与其无 id 的 componentNodeRef stub 并列出现（变体切换时二者 componentRef
* 甚至不同）。渲染事实以物化节点为准——同父下被物化节点替代的 stub 一律剔除，
* 否则母版默认内容（占位图等）会与真实内容双重渲染。
*/
/** 节点是否携带渲染信号：自身物化（id）/差量（override），或后代任一携带。 */
function hasRenderSignal(node) {
	if (nonEmptyString$1(node.id) !== void 0) return true;
	if (isRecord$2(node.override) && Object.keys(node.override).length > 0) return true;
	return Array.isArray(node.children) && node.children.filter(isRecord$2).some(hasRenderSignal);
}
function normalizeOccurrenceRoots(roots) {
	const normalizeChildren = (children, parentMaterialized) => {
		const slotTransfers = /* @__PURE__ */ new Map();
		const droppedStubs = /* @__PURE__ */ new Set();
		for (const child of children) {
			const slot = nonEmptyString$1(child.componentNodeRef);
			if (!(nonEmptyString$1(child.id) === void 0 && slot !== void 0)) continue;
			const replacement = children.find((candidate) => nonEmptyString$1(candidate.id) !== void 0 && !slotTransfers.has(candidate) && materializedReplacesStub(child, candidate));
			if (!replacement) continue;
			droppedStubs.add(child);
			if (nonEmptyString$1(child.componentRef) !== void 0 && nonEmptyString$1(replacement.componentRef) !== void 0 && nonEmptyString$1(child.componentRef) !== nonEmptyString$1(replacement.componentRef) && nonEmptyString$1(replacement.componentNodeRef) === void 0) slotTransfers.set(replacement, slot);
		}
		return children.filter((child) => {
			if (droppedStubs.has(child)) return false;
			if (parentMaterialized && nonEmptyString$1(child.id) === void 0 && nonEmptyString$1(child.componentNodeRef) !== void 0 && !hasRenderSignal(child)) return false;
			return true;
		}).map((child) => {
			const slot = slotTransfers.get(child);
			return normalizeNode(slot ? {
				...child,
				componentNodeRef: slot
			} : child);
		});
	};
	const normalizeNode = (source) => {
		let node = source;
		const override = isRecord$2(node.override) ? node.override : void 0;
		if (nonEmptyString$1(node.id) !== void 0 && node.visible === void 0 && override?.visible === void 0) node = {
			...node,
			visible: true
		};
		if (!Array.isArray(node.children) || node.children.length === 0) return node;
		return {
			...node,
			children: normalizeChildren(node.children.filter(isRecord$2), nonEmptyString$1(node.id) !== void 0)
		};
	};
	return roots.map(normalizeNode);
}
function adaptMasterArchive(masters, localStyleMap) {
	const styleIndex = buildStyleIndex(localStyleMap);
	const componentRoots = {};
	for (const master of Array.isArray(masters) ? masters : []) {
		if (!isRecord$2(master)) continue;
		const adapted = adaptMasterNode(master, styleIndex);
		if (adapted) registerComponentRoots(adapted, componentRoots);
	}
	return {
		componentRoots,
		styles: adaptStyles(localStyleMap)
	};
}
//#endregion
//#region src/parsers/pixso/pixso-format.ts
var DUPLICATED_ALPHA_EPSILON = 1e-6;
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finiteNumber(value, fallback = 0) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function optionalNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function nonEmptyString(value) {
	return typeof value === "string" && value.trim().length > 0 ? value : void 0;
}
function isPixsoNodeIdentity(value) {
	if (!isRecord$1(value)) return false;
	return nonEmptyString(value.guid) !== void 0 && nonEmptyString(value.type) !== void 0;
}
function isPixsoRootNode(value) {
	return isPixsoNodeIdentity(value) && typeof value.width === "number" && Number.isFinite(value.width) && value.width >= 0 && typeof value.height === "number" && Number.isFinite(value.height) && value.height >= 0;
}
function isPixsoDesignRoot(value) {
	if (!isRecord$1(value) || !Array.isArray(value.pixTreeNodes) || value.pixTreeNodes.length === 0) return false;
	return value.pixTreeNodes.every(isPixsoRootNode) && value.pixTreeNodes.some((node) => node.visible !== false);
}
function normalizeChannel(value) {
	return Math.max(0, Math.min(255, Math.round(finiteNumber(value))));
}
function combinedPaintAlpha(colorAlpha, paintOpacity) {
	if (colorAlpha === void 0) return paintOpacity ?? 1;
	if (paintOpacity === void 0) return colorAlpha;
	return Math.abs(colorAlpha - paintOpacity) <= DUPLICATED_ALPHA_EPSILON ? colorAlpha : colorAlpha * paintOpacity;
}
function pixsoColorToRaw(value, paintOpacity) {
	if (!isRecord$1(value)) return void 0;
	const color = value;
	const red = color.r ?? color.red;
	const green = color.g ?? color.green;
	const blue = color.b ?? color.blue;
	if (optionalNumber(red) === void 0 || optionalNumber(green) === void 0 || optionalNumber(blue) === void 0) return;
	const alpha = combinedPaintAlpha(optionalNumber(color.a ?? color.alpha), optionalNumber(paintOpacity));
	return {
		type: "color",
		red: normalizeChannel(red),
		green: normalizeChannel(green),
		blue: normalizeChannel(blue),
		alpha: Math.max(0, Math.min(1, alpha))
	};
}
function visiblePaints(value) {
	if (!Array.isArray(value)) return [];
	return value.filter((paint) => isRecord$1(paint) && paint.visible !== false);
}
function visibleEffects(value) {
	if (!Array.isArray(value)) return [];
	return value.filter((effect) => isRecord$1(effect) && effect.visible !== false);
}
function localStyle(ctx, id) {
	const styleId = nonEmptyString(id);
	if (!styleId) return void 0;
	const value = ctx.localStyleMap[styleId];
	return isRecord$1(value) ? value : void 0;
}
function paintsForNode(node, directKey, inheritedKey, ctx) {
	const direct = visiblePaints(node[directKey]);
	if (Array.isArray(node[directKey]) && node[directKey].length > 0) return direct;
	return visiblePaints(localStyle(ctx, node[inheritedKey])?.[directKey]);
}
function effectsForNode(node, ctx) {
	const effective = visibleEffects(node.effectiveEffects);
	if (Array.isArray(node.effectiveEffects) && node.effectiveEffects.length > 0) return effective;
	const direct = visibleEffects(node.effects);
	if (Array.isArray(node.effects) && node.effects.length > 0) return direct;
	return visibleEffects(localStyle(ctx, node.inheritEffectStyleID)?.effects);
}
function normalizeNodeType(type) {
	if (type === "PARAGRAPH") return "TEXT";
	if (type === "GROUP") return "FRAME";
	if (type === "SYMBOL") return "COMPONENT";
	return type;
}
function normalizeTextHorizontal(value) {
	if (typeof value !== "string") return void 0;
	const normalized = value.toLowerCase();
	if (normalized === "left" || normalized === "center" || normalized === "right" || normalized === "justify") return normalized;
}
function normalizeTextVertical(value) {
	if (typeof value !== "string") return void 0;
	const normalized = value.toLowerCase();
	if (normalized === "middle" || normalized === "center") return "center";
	if (normalized === "top" || normalized === "bottom") return normalized;
}
function cornerRadius(node) {
	const topLeft = optionalNumber(node.rectangleTopLeftCornerRadius);
	const topRight = optionalNumber(node.rectangleTopRightCornerRadius);
	const bottomRight = optionalNumber(node.rectangleBottomRightCornerRadius);
	const bottomLeft = optionalNumber(node.rectangleBottomLeftCornerRadius);
	if ([
		topLeft,
		topRight,
		bottomRight,
		bottomLeft
	].some((value) => value !== void 0)) return [
		topLeft ?? 0,
		topRight ?? 0,
		bottomRight ?? 0,
		bottomLeft ?? 0
	];
	const uniform = optionalNumber(node.cornerRadius);
	return uniform !== void 0 ? [
		uniform,
		uniform,
		uniform,
		uniform
	] : void 0;
}
function borders(node, ctx) {
	const weight = optionalNumber(node.strokeWeight);
	if (weight === void 0 || weight <= 0) return void 0;
	const solid = paintsForNode(node, "strokePaints", "inheritStrokeStyleID", ctx).find((paint) => paint.type === "SOLID");
	const color = pixsoColorToRaw(solid?.color, solid?.opacity);
	if (!solid || !color) return void 0;
	return [
		"top",
		"right",
		"bottom",
		"left"
	].map((position) => ({
		position,
		style: "solid",
		width: weight,
		color
	}));
}
function shadows(node, ctx) {
	const converted = effectsForNode(node, ctx).flatMap((effect) => {
		if (effect.type !== "DROP_SHADOW" && effect.type !== "INNER_SHADOW") return [];
		const color = pixsoColorToRaw(effect.color);
		if (!color) return [];
		return [{
			type: effect.type === "INNER_SHADOW" ? "inner" : "outer",
			color,
			x: finiteNumber(effect.offset?.x),
			y: finiteNumber(effect.offset?.y),
			blur: Math.max(0, finiteNumber(effect.radius)),
			spread: finiteNumber(effect.spread)
		}];
	});
	return converted.length > 0 ? converted : void 0;
}
function encodePathSegment(value) {
	return Array.from(value, (character) => /^[a-zA-Z0-9._-]$/.test(character) ? character : `~${character.codePointAt(0).toString(16)}~`).join("");
}
function imageAssetPath(paint) {
	const hash = nonEmptyString(paint.image?.hash);
	const name = nonEmptyString(paint.image?.name);
	if (hash) {
		const extension = name?.match(/\.[a-z0-9]+$/i)?.[0] ?? ".png";
		return `assets/pixso/hash-${encodePathSegment(hash)}${extension}`;
	}
	return name ? `assets/pixso/name-${encodePathSegment(name)}` : void 0;
}
function svgAssetPath(svgSha) {
	const value = nonEmptyString(svgSha);
	return value ? `assets/pixso/svg-${encodePathSegment(value)}` : void 0;
}
function assetReference(path, ctx) {
	let index = ctx.assetIndexes.get(path);
	if (index === void 0) {
		index = ctx.assets.length;
		ctx.assets.push(path);
		ctx.assetIndexes.set(path, index);
	}
	return `$${index}`;
}
function imageScaleStyles(value) {
	const mode = typeof value === "string" ? value.toUpperCase() : "";
	return {
		background_position: "center",
		background_repeat: "no-repeat",
		background_size: mode === "FIT" ? "contain" : mode === "STRETCH" ? "100% 100%" : "cover"
	};
}
function normalizeLayoutAlign(value) {
	if (typeof value !== "string") return void 0;
	const normalized = value.trim().toUpperCase().replace(/[ -]+/g, "_");
	if (normalized === "START" || normalized === "FLEX_START" || normalized === "LEFT" || normalized === "TOP") return "MIN";
	if (normalized === "END" || normalized === "FLEX_END" || normalized === "RIGHT" || normalized === "BOTTOM") return "MAX";
	if (normalized === "CENTER" || normalized === "SPACE_BETWEEN" || normalized === "BASELINE") return normalized;
}
function layoutNumber(layout, ...keys) {
	for (const key of keys) {
		const value = optionalNumber(layout[key]);
		if (value !== void 0) return value;
	}
}
function layoutString(layout, ...keys) {
	for (const key of keys) {
		const value = nonEmptyString(layout[key]);
		if (value !== void 0) return value;
	}
}
function designLayout(node) {
	const source = node.autoLayout;
	if (!isRecord$1(source)) return void 0;
	const stackMode = layoutString(source, "stackMode");
	const primaryAlign = normalizeLayoutAlign(source.stackPrimaryAlignItems ?? source.autoLayoutPrimaryAlign);
	const counterAlign = normalizeLayoutAlign(source.stackCounterAlignItems ?? source.autoLayoutCounterAlign);
	const translated = {};
	if (stackMode === "HORIZONTAL" || stackMode === "VERTICAL" || stackMode === "NONE") translated.stackMode = stackMode;
	if (primaryAlign) translated.stackPrimaryAlignItems = primaryAlign;
	if (counterAlign) translated.stackCounterAlignItems = counterAlign;
	const spacing = layoutNumber(source, "stackSpacing", "autoLayoutItemSpacing", "autoLayoutCounterItemSpacing");
	if (spacing !== void 0) translated.stackSpacing = spacing;
	for (const [target, input] of [
		["stackPaddingTop", "autoLayoutPaddingTop"],
		["stackPaddingRight", "autoLayoutPaddingRight"],
		["stackPaddingBottom", "autoLayoutPaddingBottom"],
		["stackPaddingLeft", "autoLayoutPaddingLeft"]
	]) {
		const value = layoutNumber(source, target, input);
		if (value !== void 0) translated[target] = value;
	}
	for (const key of [
		"stackPrimarySizing",
		"stackCounterSizing",
		"stackChildPrimarySizing",
		"stackChildCounterSizing"
	]) {
		const value = layoutString(source, key);
		if (value) translated[key] = value;
	}
	if (source.autoLayoutItemAbsolutePos === true) translated.autoLayoutAbsolutePos = true;
	if (source.stackWrap === "WRAP" || source.autoLayoutWrap === true) translated.stackWrap = "WRAP";
	if (source.stackWrap === "NO_WRAP" || source.autoLayoutWrap === false) translated.stackWrap = "NO_WRAP";
	return Object.keys(translated).length > 0 ? JSON.stringify(translated) : void 0;
}
function pluginMetadata(node) {
	if (!Array.isArray(node.props)) return {};
	for (const prop of node.props) {
		if (!isRecord$1(prop) || !Array.isArray(prop.pluginData)) continue;
		for (const entry of prop.pluginData) {
			if (!isRecord$1(entry) || typeof entry.value !== "string") continue;
			try {
				const parsed = JSON.parse(entry.value);
				if (!isRecord$1(parsed)) continue;
				const metadata = {
					componentKey: nonEmptyString(parsed.compSetKey) ?? nonEmptyString(parsed.compKey),
					componentName: nonEmptyString(parsed.compName),
					instanceProperties: parsed.attrs
				};
				if (metadata.componentKey === void 0 && metadata.componentName === void 0 && metadata.instanceProperties === void 0) continue;
				return metadata;
			} catch {}
		}
	}
	return {};
}
function inlineNodeOverrides(value) {
	if (!Array.isArray(value)) return void 0;
	const exact = /* @__PURE__ */ new Map();
	const fallback = /* @__PURE__ */ new Map();
	for (const entry of value) {
		if (!isRecord$1(entry)) continue;
		const pathString = nonEmptyString(entry.pathString);
		const componentId = nonEmptyString(entry.componentId);
		if (pathString) exact.set(pathString, entry);
		else if (componentId) fallback.set(componentId, entry);
	}
	return exact.size > 0 || fallback.size > 0 ? {
		exact,
		fallback
	} : void 0;
}
function mergeInlineNodeOverrides(inherited, own) {
	if (!inherited) return own;
	return {
		exact: new Map([...inherited.exact, ...own.exact]),
		fallback: new Map([...inherited.fallback, ...own.fallback])
	};
}
function inlineNodeOverride(node, state) {
	if (!state) return void 0;
	return state.overrides.exact.get(state.path) ?? state.overrides.fallback.get(node.guid);
}
function applyOverrideEntryFields(target, entry) {
	return {
		...target,
		...entry,
		guid: target.guid,
		name: entry.name ?? target.name,
		type: target.type,
		width: finiteNumber(entry.width, finiteNumber(target.width)),
		height: finiteNumber(entry.height, finiteNumber(target.height)),
		childNode: target.childNode
	};
}
function applyInlineNodeOverride(node, state) {
	const override = inlineNodeOverride(node, state);
	if (!override) return node;
	return applyOverrideEntryFields(node, override);
}
function childInlineOverrideState(child, inherited, own) {
	if (own) return {
		overrides: mergeInlineNodeOverrides(inherited?.overrides, own),
		path: child.guid
	};
	if (!inherited) return void 0;
	return {
		overrides: inherited.overrides,
		path: `${inherited.path}/${child.guid}`
	};
}
var MAX_MASTER_HYDRATION_DEPTH = 32;
/** 展开节点的页面 key（实例作用域合成 key），母版 guid 仅作溯源，不作页面 occurrence key。 */
var MASTER_PAGE_KEY = "__masterPageKey";
/** 打在被成功水合的 INSTANCE 上，值为解析后的 mainComponent guid。 */
var HYDRATED_FROM_MASTER = "__hydratedFromMaster";
function buildMasterIndex(value) {
	if (!Array.isArray(value) || value.length === 0) return void 0;
	const byGuid = /* @__PURE__ */ new Map();
	const register = (node, rootGuid) => {
		if (!byGuid.has(node.guid)) byGuid.set(node.guid, {
			node,
			rootGuid
		});
		for (const child of Array.isArray(node.childNode) ? node.childNode : []) if (isPixsoNodeIdentity(child)) register(child, rootGuid);
	};
	for (const root of value) if (isPixsoNodeIdentity(root)) register(root, root.guid);
	return byGuid.size > 0 ? { byGuid } : void 0;
}
function structuralChildren(node) {
	return (Array.isArray(node.childNode) ? node.childNode : []).filter(isPixsoNodeIdentity);
}
function isHydratableLeafInstance(node) {
	return node.type === "INSTANCE" && structuralChildren(node).length === 0;
}
/** props 中 pathString / componentId 直接等于 mainComponent 的条目描述实例根自身。 */
function masterRootPropsEntry(props, mainComponent) {
	if (!Array.isArray(props)) return void 0;
	for (const entry of props) {
		if (!isRecord$1(entry)) continue;
		if (nonEmptyString(entry.pathString) === mainComponent || nonEmptyString(entry.componentId) === mainComponent) return entry;
	}
}
/** 身份、几何与实例装配字段不参与母版根字段合并：页面实例事实优先。 */
var MASTER_ROOT_MERGE_EXCLUDED = new Set([
	"guid",
	"type",
	"childNode",
	"left",
	"top",
	"width",
	"height",
	"depth",
	"visible",
	"props",
	"mainComponent",
	"mainStateGroup",
	"overrideKey",
	"propRefMap",
	"propAssignMap",
	"propDefMap",
	"pathString",
	"componentId"
]);
function pickMergeableFields(source) {
	if (!source) return {};
	const picked = {};
	for (const [field, fieldValue] of Object.entries(source)) if (!MASTER_ROOT_MERGE_EXCLUDED.has(field) && fieldValue !== void 0) picked[field] = fieldValue;
	return picked;
}
/** 合并优先级：母版根默认值 < props 根条目 < 实例自身字段（D2：页面实例事实优先，母版仅补缺）。 */
function mergeMasterRootIntoInstance(instance, masterRoot, rootEntry) {
	const merged = {
		...pickMergeableFields(masterRoot),
		...pickMergeableFields(rootEntry),
		...instance
	};
	if (optionalNumber(merged.width) === void 0) merged.width = optionalNumber(masterRoot.width);
	if (optionalNumber(merged.height) === void 0) merged.height = optionalNumber(masterRoot.height);
	return merged;
}
/** 命中未展开叶子时不改变导出画面的安全字段（几何/装配元数据）；其余字段一律视为改外观。 */
var COMPOSITE_LEAF_SAFE_OVERRIDE_FIELDS = new Set([
	"pathString",
	"componentId",
	"guid",
	"type",
	"name",
	"top",
	"left",
	"width",
	"height",
	"angle",
	"flipHorizontally",
	"flipVertically",
	"visible",
	"exportSettings",
	"autoLayout",
	"autoLayoutByParent",
	"pluginData",
	"componentNormName",
	"overrideKey",
	"propRefMap",
	"propAssignMap",
	"propDefMap"
]);
function entryTouchesAppearance(entry) {
	return Object.keys(entry).some((field) => !COMPOSITE_LEAF_SAFE_OVERRIDE_FIELDS.has(field));
}
function masterOverrideScope(props, consumed) {
	const overrides = inlineNodeOverrides(props);
	if (!overrides) return void 0;
	return {
		exact: overrides.exact,
		fallback: overrides.fallback,
		relPath: "",
		consumed
	};
}
function extendScopes(scopes, instanceGuid) {
	return scopes.map((scope) => ({
		...scope,
		relPath: scope.relPath ? `${scope.relPath}/${instanceGuid}` : instanceGuid
	}));
}
/** 外层 occurrence 条目优先于母版内部默认：scopes 按外→内排列，应用时内先外后。 */
function applyMasterOverrides(clone, scopes, state) {
	let result = clone;
	const matchedEntries = [];
	for (let i = scopes.length - 1; i >= 0; i -= 1) {
		const scope = scopes[i];
		const exactKey = scope.relPath ? `${scope.relPath}/${clone.guid}` : clone.guid;
		let matchedKey;
		let entry = scope.exact.get(exactKey);
		if (entry) matchedKey = exactKey;
		else {
			entry = scope.fallback.get(clone.guid);
			if (entry) matchedKey = clone.guid;
		}
		if (!entry || matchedKey === void 0) continue;
		scope.consumed?.add(matchedKey);
		matchedEntries.push(entry);
		if (state.imageTouch === void 0 && entryTouchesImage(entry, result, state.ctx)) state.imageTouch = exactKey;
		result = applyOverrideEntryFields(result, entry);
	}
	return {
		node: result,
		matchedEntries
	};
}
/** 实例节点为其子树开启的 override 作用域：既有 scopes 延长一跳 + 自身 props 的新 scope。 */
function instanceChildScopes(masterNode, scopes) {
	const extended = [...extendScopes(scopes, masterNode.guid)];
	const ownScope = masterOverrideScope(masterNode.props);
	if (ownScope) extended.push(ownScope);
	return extended;
}
/**
* 克隆母版子树供某个实例使用：每个克隆带实例作用域页面 key，override 在克隆时烘焙；
* 母版内的嵌套 INSTANCE 携带解析栈递归展开，循环 / 超深回退为叶子（后续按 composite 处理）。
*/
function expandMasterSubtree(masterNode, scopePageKey, occHopPath, stack, scopes, state) {
	const pageKey = `${scopePageKey}/${masterNode.guid}`;
	const { node: clone, matchedEntries } = applyMasterOverrides({
		...masterNode,
		[MASTER_PAGE_KEY]: pageKey
	}, scopes, state);
	const inlineChildren = structuralChildren(masterNode);
	if (masterNode.type === "INSTANCE" && inlineChildren.length === 0) {
		const selfOccKey = occHopPath ? `${occHopPath}/${masterNode.guid}` : masterNode.guid;
		const keepAsCompositeLeaf = () => {
			state.compositeLeafHops.add(selfOccKey);
			if (state.overriddenCompositeLeaf === void 0 && matchedEntries.some(entryTouchesAppearance)) state.overriddenCompositeLeaf = selfOccKey;
			return clone;
		};
		const mainComponent = nonEmptyString(masterNode.mainComponent);
		const entry = mainComponent ? state.index.byGuid.get(mainComponent) : void 0;
		if (!mainComponent || !entry) {
			state.issues.push({
				code: mainComponent ? "unresolved-main-component" : "missing-main-component",
				instance_guid: masterNode.guid
			});
			return keepAsCompositeLeaf();
		}
		if (stack.includes(mainComponent)) {
			state.issues.push({
				code: "cyclic-master-ref",
				instance_guid: masterNode.guid,
				detail: mainComponent
			});
			return keepAsCompositeLeaf();
		}
		if (stack.length >= MAX_MASTER_HYDRATION_DEPTH) {
			state.issues.push({
				code: "master-depth-exceeded",
				instance_guid: masterNode.guid,
				detail: mainComponent
			});
			return keepAsCompositeLeaf();
		}
		const rootEntry = masterRootPropsEntry(masterNode.props, mainComponent);
		if (rootEntry && state.imageTouch === void 0 && entryTouchesImage(rootEntry, clone, state.ctx)) state.imageTouch = `${pageKey}#root`;
		const masterChildren = structuralChildren(entry.node);
		if (masterChildren.length === 0) {
			state.issues.push({
				code: "empty-master-root",
				instance_guid: masterNode.guid,
				detail: mainComponent
			});
			return keepAsCompositeLeaf();
		}
		const merged = mergeMasterRootIntoInstance(clone, entry.node, rootEntry);
		merged[MASTER_PAGE_KEY] = pageKey;
		merged[HYDRATED_FROM_MASTER] = mainComponent;
		merged.props = void 0;
		const nextStack = [...stack, mainComponent];
		const childScopes = instanceChildScopes(masterNode, scopes);
		merged.childNode = masterChildren.map((child) => expandMasterSubtree(child, pageKey, selfOccKey, nextStack, childScopes, state));
		return merged;
	}
	const isInlineInstance = masterNode.type === "INSTANCE";
	let childScopes = scopes;
	let childOccHopPath = occHopPath;
	if (isInlineInstance) {
		childScopes = instanceChildScopes(masterNode, scopes);
		childOccHopPath = occHopPath ? `${occHopPath}/${masterNode.guid}` : masterNode.guid;
		clone.props = void 0;
	}
	clone.childNode = inlineChildren.map((child) => expandMasterSubtree(child, isInlineInstance ? pageKey : scopePageKey, childOccHopPath, stack, childScopes, state));
	return clone;
}
/** override 条目中会改变图像呈现的字段（design D4：从宽判定，触及即回退）。 */
var IMAGE_TOUCH_FIELDS = [
	"fillPaints",
	"svgSha",
	"visible",
	"inheritFillStyleID"
];
function paintsCarryImage(paints) {
	return paints.some((paint) => paint.type === "IMAGE");
}
function nodeCarriesImage(node, ctx) {
	if (nonEmptyString(node.svgSha)) return true;
	return paintsCarryImage(paintsForNode(node, "fillPaints", "inheritFillStyleID", ctx));
}
function entryTouchesImage(entry, node, ctx) {
	if (!IMAGE_TOUCH_FIELDS.some((field) => field in entry)) return false;
	if (nodeCarriesImage(node, ctx)) return true;
	return paintsCarryImage(visiblePaints(entry.fillPaints)) || nonEmptyString(entry.svgSha) !== void 0;
}
/**
* 对页面树中的叶子 INSTANCE 尝试母版展开；不可展开（缺母版 / 不可解析 / 护栏触发 /
* override 分级回退）时返回 undefined，调用方保持现状 composite 行为。
* 图片身份分级（design D4）：override 触及图像属性或条目不可映射 → 整实例回退。
*/
function hydrateLeafInstance(node, ctx) {
	const hydration = ctx.masterHydration;
	const mainComponent = nonEmptyString(node.mainComponent);
	if (!mainComponent) {
		hydration.issues.push({
			code: "missing-main-component",
			instance_guid: node.guid
		});
		return;
	}
	if (!hydration.index) {
		hydration.issues.push({
			code: "missing-master-tree",
			instance_guid: node.guid,
			detail: mainComponent
		});
		return;
	}
	const entry = hydration.index.byGuid.get(mainComponent);
	if (!entry) {
		hydration.issues.push({
			code: "unresolved-main-component",
			instance_guid: node.guid,
			detail: mainComponent
		});
		return;
	}
	const mainStateGroup = nonEmptyString(node.mainStateGroup);
	if (mainStateGroup && mainStateGroup !== entry.rootGuid) hydration.issues.push({
		code: "main-state-group-mismatch",
		instance_guid: node.guid,
		detail: `${mainStateGroup} != ${entry.rootGuid}`
	});
	const masterChildren = structuralChildren(entry.node);
	if (masterChildren.length === 0) {
		hydration.issues.push({
			code: "empty-master-root",
			instance_guid: node.guid,
			detail: mainComponent
		});
		return;
	}
	const rootEntry = masterRootPropsEntry(node.props, mainComponent);
	if (rootEntry && entryTouchesImage(rootEntry, node, ctx)) {
		hydration.issues.push({
			code: "override-image-fallback",
			instance_guid: node.guid,
			detail: `${node.guid}#root`
		});
		return;
	}
	const consumed = /* @__PURE__ */ new Set();
	const occurrenceScope = masterOverrideScope(node.props, consumed);
	const scopes = occurrenceScope ? [occurrenceScope] : [];
	const candidateIssues = [];
	const state = {
		index: hydration.index,
		ctx,
		issues: candidateIssues,
		compositeLeafHops: /* @__PURE__ */ new Set()
	};
	const merged = mergeMasterRootIntoInstance(node, entry.node, rootEntry);
	merged[HYDRATED_FROM_MASTER] = mainComponent;
	merged.props = void 0;
	merged.childNode = masterChildren.map((child) => expandMasterSubtree(child, node.guid, "", [mainComponent], scopes, state));
	if (state.imageTouch !== void 0) {
		hydration.issues.push({
			code: "override-image-fallback",
			instance_guid: node.guid,
			detail: state.imageTouch
		});
		return;
	}
	if (state.overriddenCompositeLeaf !== void 0) {
		hydration.issues.push({
			code: "composite-leaf-override-fallback",
			instance_guid: node.guid,
			detail: state.overriddenCompositeLeaf
		});
		return;
	}
	if (occurrenceScope) {
		const hops = [...state.compositeLeafHops];
		const warnings = [];
		const recordUnmapped = (key, dangerous) => {
			if (dangerous) {
				hydration.issues.push({
					code: "unmappable-override-fallback",
					instance_guid: node.guid,
					detail: key
				});
				return { shouldFallback: true };
			}
			warnings.push({
				code: "unmapped-override-ignored",
				instance_guid: node.guid,
				detail: key
			});
			return { shouldFallback: false };
		};
		for (const key of occurrenceScope.exact.keys()) {
			if (key === mainComponent || consumed.has(key)) continue;
			if (recordUnmapped(key, hops.some((hop) => key === hop || key.startsWith(`${hop}/`))).shouldFallback) return void 0;
		}
		for (const key of occurrenceScope.fallback.keys()) {
			if (key === mainComponent || consumed.has(key)) continue;
			if (recordUnmapped(key, hops.length > 0).shouldFallback) return void 0;
		}
		candidateIssues.push(...warnings);
	}
	hydration.issues.push(...candidateIssues);
	return merged;
}
function firstRasterResource(paints) {
	for (const paint of paints) {
		if (paint.type !== "IMAGE") continue;
		const path = imageAssetPath(paint);
		if (path) return {
			rasterPaint: paint,
			rasterPath: path
		};
	}
	return {};
}
function rawStyle(node, type, ctx) {
	const style = {
		origin_width: Math.max(0, finiteNumber(node.width)),
		origin_height: Math.max(0, finiteNumber(node.height))
	};
	const opacity = optionalNumber(node.opacity);
	if (opacity !== void 0) style.opacity = Math.max(0, Math.min(1, opacity));
	const fills = paintsForNode(node, "fillPaints", "inheritFillStyleID", ctx);
	const solid = fills.find((paint) => paint.type === "SOLID");
	const color = pixsoColorToRaw(solid?.color, solid?.opacity);
	if (color) if (type === "TEXT") style.font_color = color;
	else style.background_color = color;
	const { rasterPaint: imagePaint, rasterPath: imagePath } = firstRasterResource(fills);
	const svgPath = svgAssetPath(node.svgSha);
	const resourcePath = imagePath ?? svgPath;
	if (resourcePath) {
		style.background_image = assetReference(resourcePath, ctx);
		Object.assign(style, imageScaleStyles(imagePaint?.imageScaleMode));
	}
	if (type === "TEXT") {
		const fontFamily = nonEmptyString(node.fontFamily);
		const fontSize = optionalNumber(node.fontSize);
		const fontWeight = optionalNumber(node.fontWeight);
		const lineHeight = optionalNumber(node.lineHeightNumber);
		const letterSpacing = optionalNumber(node.letterSpacingNumber ?? node.letterSpacing);
		if (fontFamily) style.font_family = fontFamily;
		if (fontSize !== void 0) style.font_size = fontSize;
		if (fontWeight !== void 0) style.font_weight = fontWeight;
		if (lineHeight !== void 0) style.line_height = lineHeight;
		if (letterSpacing !== void 0) style.letter_spacing = letterSpacing;
		const horizontal = normalizeTextHorizontal(node.textAlignHorizontal);
		const vertical = normalizeTextVertical(node.textAlignVertical);
		if (horizontal) style.text_align_horizontal = horizontal;
		if (vertical) style.text_align_vertical = vertical;
	}
	const border = borders(node, ctx);
	const radius = cornerRadius(node);
	const shadow = shadows(node, ctx);
	if (border) style.border = border;
	if (radius) style.round_corner = radius;
	if (shadow) style.shadow = shadow;
	const rotation = optionalNumber(node.rotationAngle ?? node.rotation);
	if (rotation !== void 0) style.rotation_angle = rotation;
	return {
		style,
		resources: {
			rasterPaint: imagePaint,
			rasterPath: imagePath,
			svgPath
		}
	};
}
function pixsoNodeMetadata(node, resources) {
	const metadata = {
		guid: node.guid,
		source_type: node.type
	};
	if (nonEmptyString(node[MASTER_PAGE_KEY])) metadata.hydrated_from_master_tree = true;
	const hydratedMainComponent = nonEmptyString(node[HYDRATED_FROM_MASTER]);
	if (hydratedMainComponent) metadata.hydrated_main_component = hydratedMainComponent;
	const imageHash = nonEmptyString(resources.rasterPaint?.image?.hash);
	const imageName = nonEmptyString(resources.rasterPaint?.image?.name);
	const svgSha = nonEmptyString(node.svgSha);
	const mainComponent = nonEmptyString(node.mainComponent);
	const componentKey = nonEmptyString(node.componentKey);
	if (imageHash) metadata.image_hash = imageHash;
	if (imageName) metadata.image_name = imageName;
	if (resources.rasterPath) metadata.image_asset = resources.rasterPath;
	if (svgSha) metadata.svg_sha = svgSha;
	if (resources.svgPath) metadata.svg_asset = resources.svgPath;
	if (mainComponent) metadata.main_component = mainComponent;
	if (componentKey) metadata.component_key = componentKey;
	if (node.strokeAlign !== void 0) metadata.stroke_align = node.strokeAlign;
	if (node.fontStyle !== void 0) metadata.font_style = node.fontStyle;
	return metadata;
}
function componentInstanceMetadata(node, key) {
	const plugin = pluginMetadata(node);
	const componentKey = nonEmptyString(node.componentKey);
	return {
		component_key: plugin.componentKey ?? componentKey,
		instance_name: plugin.componentName ?? nonEmptyString(node.name) ?? key,
		symbol_key: componentKey,
		instance_properties: plugin.instanceProperties
	};
}
function convertNode$1(sourceNode, parentX, parentY, ctx, overrideState) {
	let node = applyInlineNodeOverride(sourceNode, overrideState);
	if (isHydratableLeafInstance(node) && nonEmptyString(node[MASTER_PAGE_KEY]) === void 0) node = hydrateLeafInstance(node, ctx) ?? node;
	const x = parentX + finiteNumber(node.left);
	const y = parentY + finiteNumber(node.top);
	const width = Math.max(0, finiteNumber(node.width));
	const height = Math.max(0, finiteNumber(node.height));
	const type = normalizeNodeType(node.type);
	const key = nonEmptyString(node[MASTER_PAGE_KEY]) ?? node.guid;
	const { style, resources } = rawStyle({
		...node,
		width,
		height
	}, type, ctx);
	const svgSha = nonEmptyString(node.svgSha);
	const extend = { pixso: pixsoNodeMetadata(node, resources) };
	const translatedLayout = designLayout(node);
	if (translatedLayout) extend.design_layout = translatedLayout;
	const raw = {
		key,
		name: nonEmptyString(node.name) ?? key,
		type,
		box: {
			x,
			y,
			width,
			height
		},
		style,
		extend
	};
	if (type === "TEXT" && typeof node.nodeText === "string") raw.content = node.nodeText;
	if (node.type === "INSTANCE") raw.component_instance = componentInstanceMetadata(node, key);
	const ownOverrides = node.type === "INSTANCE" ? inlineNodeOverrides(node.props) : void 0;
	const inlineChildren = (Array.isArray(node.childNode) ? node.childNode : []).filter(isPixsoNodeIdentity).map((child) => ({
		child,
		state: childInlineOverrideState(child, overrideState, ownOverrides)
	})).filter(({ child, state }) => applyInlineNodeOverride(child, state).visible !== false);
	const leafInstance = node.type === "INSTANCE" && inlineChildren.length === 0;
	const children = inlineChildren.map(({ child, state }) => convertNode$1(child, x, y, ctx, state));
	if (children.length > 0) raw.children = children;
	if (leafInstance) {
		extend.image_role = "content";
		extend.image_source = "composite";
	} else if (resources.rasterPath) {
		extend.image_role = children.length > 0 ? "background" : "content";
		extend.image_source = "raster";
	} else if (resources.svgPath) {
		extend.image_role = children.length > 0 ? "background" : "content";
		extend.image_source = "vector";
		extend.vector_shape = svgSha;
		if (children.length === 0) extend.icon = true;
	}
	return raw;
}
function unionRoot(nodes) {
	const minX = Math.min(...nodes.map((node) => node.box.x));
	const minY = Math.min(...nodes.map((node) => node.box.y));
	const maxX = Math.max(...nodes.map((node) => node.box.x + node.box.width));
	const maxY = Math.max(...nodes.map((node) => node.box.y + node.box.height));
	const width = maxX - minX;
	const height = maxY - minY;
	return {
		key: "pixso:root",
		name: "Pixso Design",
		type: "FRAME",
		box: {
			x: minX,
			y: minY,
			width,
			height
		},
		style: {
			origin_width: width,
			origin_height: height
		},
		extend: { pixso: { synthetic_root: true } },
		children: nodes
	};
}
function isPixsoDualDslInput(value) {
	if (!isRecord$1(value)) return false;
	return isPixsoDesignRoot(value.full) && isRecord$1(value.occurrence);
}
/**
* 把两份 get_node_dsl 返回拼成双模式快照（consume-pixso-occurrence-dsl D2）：
* simplify=false 快照原样为底，simplify=true 的 roots + refsIndex 挂到
* occurrenceDsl（剥 stats）。显式双文件调用对非法 occurrence 抛错，不做静默降级。
*/
function assemblePixsoDualDesignRoot(full, occurrence) {
	if (!isPixsoDesignRoot(full)) throw new TypeError("assemblePixsoDualDesignRoot: full 不是有效的 simplify=false 快照（缺 pixTreeNodes）");
	if (!isRecord$1(occurrence) || !Array.isArray(occurrence.roots) || occurrence.roots.length === 0) throw new TypeError("assemblePixsoDualDesignRoot: occurrence 不是有效的 simplify=true 返回（缺非空 roots）");
	return {
		...full,
		occurrenceDsl: {
			roots: occurrence.roots,
			refsIndex: isRecord$1(occurrence.refsIndex) ? occurrence.refsIndex : {}
		}
	};
}
/** 校验 occurrenceDsl 基本形状；缺失返回 undefined，存在但非法返回 'invalid'。 */
function occurrenceDslInput(value) {
	if (value === void 0 || value === null) return void 0;
	if (!isRecord$1(value)) return "invalid";
	const roots = value.roots;
	if (!Array.isArray(roots) || roots.length === 0) return "invalid";
	if (!roots.every((root) => isRecord$1(root) && nonEmptyString(root.type) !== void 0)) return "invalid";
	return {
		roots,
		refsIndex: isRecord$1(value.refsIndex) ? value.refsIndex : {},
		...isRecord$1(value.resolvedRefs) ? { resolvedRefs: value.resolvedRefs } : {}
	};
}
/** occurrence 路由：页面结构以 ① 为唯一事实来源，② 仅供母版档案与样式（design D1/D3）。 */
function convertViaOccurrenceDsl(input, occurrence) {
	const adapted = adaptMasterArchive(input.pixComponentTreeDslNodes, input.localStyleMap);
	const explicit = occurrence.resolvedRefs;
	const explicitStyles = explicit?.styles;
	const styles = Array.isArray(explicitStyles) ? [...explicitStyles, ...Object.entries(adapted.styles).map(([key, entry]) => ({
		style_key: key,
		...entry
	}))] : {
		...adapted.styles,
		...isRecord$1(explicitStyles) ? explicitStyles : {}
	};
	const raw = convertPixsoRefsToRawNewRoot({
		roots: normalizeOccurrenceRoots(occurrence.roots),
		refsIndex: occurrence.refsIndex,
		resolvedRefs: {
			...explicit ?? {},
			componentRoots: {
				...adapted.componentRoots,
				...explicit?.componentRoots ?? {}
			},
			styles
		}
	}, { occurrenceDslProfile: true });
	return {
		...raw,
		meta: {
			...isRecord$1(raw.meta) ? raw.meta : {},
			source: "pixso",
			name: raw.content[0]?.name,
			isContainFixed: input.isContainFixed === true,
			occurrence_dsl: true
		}
	};
}
function convertPixsoToRawNewRoot(input) {
	if (!isPixsoDesignRoot(input)) throw new Error("convertPixsoToRawNewRoot: 输入不是有效的 Pixso 设计稿数据");
	const occurrence = occurrenceDslInput(input.occurrenceDsl);
	if (occurrence !== void 0 && occurrence !== "invalid") return convertViaOccurrenceDsl(input, occurrence);
	const ctx = {
		assets: [],
		assetIndexes: /* @__PURE__ */ new Map(),
		localStyleMap: isRecord$1(input.localStyleMap) ? input.localStyleMap : {},
		masterHydration: {
			index: buildMasterIndex(input.pixComponentTreeDslNodes),
			issues: []
		}
	};
	if (occurrence === "invalid") ctx.masterHydration.issues.push({
		code: "invalid-occurrence-dsl",
		instance_guid: "occurrenceDsl"
	});
	const roots = input.pixTreeNodes.filter((node) => node.visible !== false).map((node) => convertNode$1(node, 0, 0, ctx));
	if (roots.length === 0) throw new Error("convertPixsoToRawNewRoot: pixTreeNodes 没有可见根节点");
	const root = roots.length === 1 ? roots[0] : unionRoot(roots);
	const issues = ctx.masterHydration.issues;
	return {
		assets: ctx.assets,
		content: [root],
		meta: {
			source: "pixso",
			name: root.name,
			isContainFixed: input.isContainFixed === true,
			...issues.length > 0 ? { master_hydration_issues: issues } : {}
		}
	};
}
//#endregion
//#region src/shared/layoutTopology.ts
var right = (b) => b.x + b.width;
var bottom = (b) => b.y + b.height;
/** 两个 bbox 的交集；无交集返回 null */
function intersection(a, b) {
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	const r = Math.min(right(a), right(b));
	const btm = Math.min(bottom(a), bottom(b));
	if (r <= x || btm <= y) return null;
	return {
		x,
		y,
		width: r - x,
		height: btm - y
	};
}
/** outer 是否完整包含 inner（允许误差 tol） */
function contains(outer, inner, tol = 0) {
	return inner.x >= outer.x - tol && inner.y >= outer.y - tol && right(inner) <= right(outer) + tol && bottom(inner) <= bottom(outer) + tol;
}
//#endregion
//#region src/pipeline/passes/protected-mark.ts
var PROTECTED_MARK_KEYS = ["design_mark", "custom_mark"];
function nodeHasProtectedMark(node) {
	const ext = node.extend;
	if (!ext) return false;
	return PROTECTED_MARK_KEYS.some((k) => Object.prototype.hasOwnProperty.call(ext, k));
}
function subtreeHasProtectedMark(node, includeSelf = true) {
	if (includeSelf && nodeHasProtectedMark(node)) return true;
	return (node.children ?? []).some((c) => subtreeHasProtectedMark(c, true));
}
//#endregion
//#region src/pipeline/passes/occlusion.ts
var EPS = .5;
function parseRadius$1(s) {
	if (!s) return [
		0,
		0,
		0,
		0
	];
	const [a, b = a, c = a, d = b] = s.split(/\s+/).map((p) => parseFloat(p) || 0);
	return [
		a,
		b,
		c,
		d
	];
}
function isTransparentColor$1(c) {
	const t = c.trim().toLowerCase();
	if (!t || t === "transparent" || t === "none") return true;
	const m = t.match(/rgba?\(([^)]+)\)/);
	if (m) {
		const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
		if (parts.length === 4 && (isNaN(parts[3]) || parts[3] <= 0)) return true;
	}
	if (/^#[0-9a-f]{8}$/.test(t) && t.slice(-2) === "00") return true;
	return false;
}
function gradientHasTransparentStop(backgroundImage) {
	if (!backgroundImage) return false;
	const re = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([\d.]+))?\s*\)/gi;
	let m;
	while ((m = re.exec(backgroundImage)) !== null) {
		if (m[1] === void 0) continue;
		const a = parseFloat(m[1]);
		if (!isNaN(a) && a < 1) return true;
	}
	const hex = /#[0-9a-f]{6}([0-9a-f]{2})/gi;
	while ((m = hex.exec(backgroundImage)) !== null) if (parseInt(m[1], 16) < 255) return true;
	return false;
}
function nodeHasTransparency(node) {
	if (node.imageOpaque === false) return true;
	const s = node.style;
	if (!s) return false;
	if (s.opacity !== void 0 && s.opacity < 1) return true;
	if (gradientHasTransparentStop(s.backgroundImage)) return true;
	return false;
}
function subtreeHasTransparency(root) {
	if (nodeHasTransparency(root)) return true;
	return (root.children ?? []).some(subtreeHasTransparency);
}
function isOpaqueFill(node) {
	const s = node.style;
	if (s?.opacity !== void 0 && s.opacity < 1) return false;
	if (s?.filter) return false;
	if (node.type === "IMAGE" && node.imageSource === "icon-font") return false;
	if (node.type === "IMAGE" && node.imageOpaque === false) return false;
	if (s?.backgroundImage && gradientHasTransparentStop(s.backgroundImage)) return false;
	const hasSolidColor = !!s?.backgroundColor && !isTransparentColor$1(s.backgroundColor);
	const hasImage = !!s?.backgroundImage;
	const isImageType = node.type === "IMAGE";
	return hasSolidColor || hasImage || isImageType;
}
function subtreeHasInputContent(node) {
	if (node.type === "TEXT" && node.characters?.trim()) return true;
	if (node.type === "IMAGE" && node.imageSource === "icon-font") return true;
	return (node.children ?? []).some(subtreeHasInputContent);
}
function isInputPlaceholderOverContent(occluder, covered) {
	return occluder.type === "SUPPOSITIONAL" && occluder.name.includes("FloatingTab") && occluder.geometry.height <= 48 + EPS && subtreeHasInputContent(covered);
}
function aCoversB(a, b, aEff, bEff) {
	if (a.geometry.rotation || b.geometry.rotation) return false;
	if (!contains(aEff, bEff, EPS)) return false;
	const ar = parseRadius$1(a.style?.borderRadius);
	const br = parseRadius$1(b.style?.borderRadius);
	const mL = b.geometry.x - a.geometry.x;
	const mT = b.geometry.y - a.geometry.y;
	const mR = a.geometry.x + a.geometry.width - (b.geometry.x + b.geometry.width);
	const mB = a.geometry.y + a.geometry.height - (b.geometry.y + b.geometry.height);
	if (ar[0] - Math.min(mL, mT) > br[0] + EPS) return false;
	if (ar[1] - Math.min(mR, mT) > br[1] + EPS) return false;
	if (ar[2] - Math.min(mR, mB) > br[2] + EPS) return false;
	if (ar[3] - Math.min(mL, mB) > br[3] + EPS) return false;
	return true;
}
function buildCtx(root) {
	const ctx = /* @__PURE__ */ new Map();
	const walkDown = (n, anc, parentEff) => {
		const selfBox = {
			x: n.geometry.x,
			y: n.geometry.y,
			width: n.geometry.width,
			height: n.geometry.height
		};
		const eff = n.isPageRoot ? selfBox : parentEff ? intersection(selfBox, parentEff) : selfBox;
		ctx.set(n.id, {
			node: n,
			ancestors: anc,
			descendants: /* @__PURE__ */ new Set(),
			effRect: eff
		});
		const nextAnc = new Set(anc).add(n.id);
		n.children?.forEach((c) => walkDown(c, nextAnc, eff));
	};
	walkDown(root, /* @__PURE__ */ new Set(), null);
	const walkUp = (n) => {
		const own = /* @__PURE__ */ new Set();
		for (const c of n.children ?? []) {
			const childDesc = walkUp(c);
			own.add(c.id);
			childDesc.forEach((id) => own.add(id));
		}
		ctx.get(n.id).descendants = own;
		return own;
	};
	walkUp(root);
	return ctx;
}
function findOccludedIds(root) {
	const ctx = buildCtx(root);
	const all = Array.from(ctx.values());
	const occluded = /* @__PURE__ */ new Set();
	for (const bCtx of all) {
		const B = bCtx.node;
		if (B.isPageRoot) continue;
		if (subtreeHasProtectedMark(B)) continue;
		if (!bCtx.effRect) {
			occluded.add(B.id);
			continue;
		}
		for (const aCtx of all) {
			const A = aCtx.node;
			if (A.id === B.id) continue;
			if (A.renderOrder <= B.renderOrder) continue;
			if (bCtx.ancestors.has(A.id)) continue;
			if (bCtx.descendants.has(A.id)) continue;
			if (!aCtx.effRect) continue;
			if (isInputPlaceholderOverContent(A, B)) continue;
			if (!isOpaqueFill(A)) continue;
			if (!aCoversB(A, B, aCtx.effRect, bCtx.effRect)) continue;
			occluded.add(B.id);
			break;
		}
	}
	return occluded;
}
function pruneIds$1(node, ids) {
	if (!node.children) return;
	node.children = node.children.filter((c) => !ids.has(c.id));
	node.children.forEach((c) => pruneIds$1(c, ids));
}
/**
* 剔除被完全遮挡的节点（连带子树）。
* 返回剔除数量。典型用法：放在所有 image 识别 pass 之后、fillTreeMetadata 之前。
*/
function cullOccludedNodes(root) {
	const occluded = findOccludedIds(root);
	if (occluded.size === 0) return 0;
	pruneIds$1(root, occluded);
	return occluded.size;
}
//#endregion
//#region src/shared/flow-rules.ts
/**
* Returns true for children that are out-of-flow from the flex algorithm's perspective.
* 单一真值源——由 algorithm（src/adapters/stage14/）和 renderer（src/preview/FlexPreviewRenderer.tsx）
* 共享。两边的判定必须始终一致，否则 cursor 累加和 DOM 分类会不一致，导致渲染错位。
*
* Out-of-flow categorizations:
*   1. autoLayout absolute-positioned children (hints.autoLayoutChild.absolute === true) ——
*      figma 原生 hint 标记的 overlay child（badge / fab 等）
*   2. isBackgroundImageLayer children ——
*      纯背景图（rendered 为 absolute overlay 画在底层）；background-container with children
*      除外（它仍然是承载内容的 wrapper container，需要进入 flow）
*   3. node.outOfFlow !== undefined —— stage14 算法标记的 out-of-flow 分类:
*      - 'stage14-overlay':       A2 套娃通路抽出的 inner child(outer 4× 大于 inner)
*      - 'stage14-overlay-leaf':  A3 leaf 装饰通路抽出的 outer child(outer 是 leaf 节点)
*      - 'stage14-overlay-stack': stage14 reparent pass 后仍触发 T1 的图标 stack 上抽出
*                                  (双图标边长比 < 1.2 且重叠 ≥ 0.9,renderOrder 大的标此)
*      未来可继续扩展 union(e.g., 'stage14-fixed-position')
*/
function isBackgroundImageLayer$1(c) {
	return c.imageRole === "background" && !(c.virtualContainer?.kind === "background-container" && (c.children?.length ?? 0) > 0);
}
function isOutOfFlow(c) {
	if (c.hints?.autoLayoutChild?.absolute) return true;
	if (isBackgroundImageLayer$1(c)) return true;
	if (c.outOfFlow !== void 0) return true;
	return false;
}
//#endregion
//#region src/pipeline/passes/clipping.ts
var EPSILON = .5;
var EXPLICIT_BOOLEAN_FIELDS = [
	"clipsContent",
	"clips_content",
	"clip",
	"clips",
	"crop"
];
var EXPLICIT_INTENTS = new Set([
	"viewport",
	"image-crop",
	"mask-shape",
	"visual-overflow",
	"effect-overflow",
	"composite-image",
	"normal-container",
	"unknown"
]);
var EXPLICIT_CONFIDENCES = new Set([
	"explicit",
	"strong",
	"weak",
	"fallback"
]);
var EXPLICIT_OVERFLOWS = new Set(["hidden", "visible"]);
function withReason(reasons, reason) {
	return reasons.includes(reason) ? reasons : [...reasons, reason];
}
function decision(overflow, intent, confidence, reasons) {
	return {
		overflow,
		intent,
		confidence,
		reasons: reasons.length > 0 ? reasons : ["fallback-visible"]
	};
}
function isValidClipDecision(value) {
	if (!value || typeof value !== "object") return false;
	const candidate = value;
	return EXPLICIT_OVERFLOWS.has(candidate.overflow) && EXPLICIT_INTENTS.has(candidate.intent) && EXPLICIT_CONFIDENCES.has(candidate.confidence) && Array.isArray(candidate.reasons) && candidate.reasons.length > 0 && candidate.reasons.every((reason) => typeof reason === "string");
}
function existingExplicitDecision(node) {
	if (isValidClipDecision(node.clipDecision)) return node.clipDecision;
	const fromExtend = node.extend?.clip_decision;
	if (isValidClipDecision(fromExtend)) return fromExtend;
}
function booleanish(value) {
	if (typeof value === "boolean") return value;
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (normalized === "true" || normalized === "hidden" || normalized === "clip" || normalized === "crop") return true;
		if (normalized === "false" || normalized === "visible" || normalized === "none") return false;
	}
}
function explicitFieldDecision(node) {
	const ext = node.extend;
	if (!ext) return void 0;
	const overflow = ext.overflow;
	if (EXPLICIT_OVERFLOWS.has(overflow)) {
		const cssOverflow = overflow;
		return decision(cssOverflow, cssOverflow === "hidden" ? "image-crop" : "unknown", "explicit", [`explicit-overflow-${cssOverflow}`]);
	}
	for (const field of EXPLICIT_BOOLEAN_FIELDS) {
		if (!(field in ext)) continue;
		const value = booleanish(ext[field]);
		if (value === void 0) continue;
		return decision(value ? "hidden" : "visible", value ? "image-crop" : "unknown", "explicit", [value ? "explicit-clip-hidden" : "explicit-clip-visible"]);
	}
}
function noExplicit(reasons) {
	return withReason(reasons, "no-explicit-clip-field");
}
function overflowEvidence(parent, child) {
	const p = parent.geometry;
	const c = child.geometry;
	return {
		left: c.x < p.x - EPSILON,
		top: c.y < p.y - EPSILON,
		right: c.x + c.width > p.x + p.width + EPSILON,
		bottom: c.y + c.height > p.y + p.height + EPSILON
	};
}
function hasOverflow(evidence) {
	return evidence.left || evidence.right || evidence.top || evidence.bottom;
}
function overflowReasons(evidence) {
	const reasons = [];
	if (evidence.left) reasons.push("direct-child-overflows-parent-left");
	if (evidence.right) reasons.push("direct-child-overflows-parent-right");
	if (evidence.top) reasons.push("direct-child-overflows-parent-top");
	if (evidence.bottom) reasons.push("direct-child-overflows-parent-bottom");
	return reasons;
}
function isSuppositional(node) {
	return node.type === "SUPPOSITIONAL" || /suppositional/i.test(node.name);
}
function hasBackgroundImageSignal(node) {
	return Boolean(node.imageUrl || node.style?.backgroundImage?.includes("url(") || node.extend?.background_image || node.extend?.image_source === "raster");
}
function hasImageCropSignal(node) {
	return node.imageSource === "raster" || hasBackgroundImageSignal(node);
}
function hasMaskSignal(node) {
	if (node.extend?.mask === true) return true;
	if (node.name.includes("蒙版") || /mask/i.test(node.name)) return true;
	if (node.style?.borderRadius && node.children?.some(hasImageCropSignal)) return true;
	return false;
}
function hasEffectOverflowSignal(node) {
	return Boolean(node.style?.boxShadow || node.style?.textShadow);
}
function isCompositeImage(node) {
	return node.type === "IMAGE" && node.imageSource === "composite";
}
function visualOverflowSignal(parent, child) {
	const text = `${parent.name} ${child.name}`.toLowerCase();
	return /banner|card|bottom|overlay|gradient|蒙层|编组|底部|渐变/.test(text) || child.imageSource === "composite";
}
function descendantHasCrop(node) {
	for (const child of node.children ?? []) {
		const d = child.clipDecision;
		if (d?.overflow === "hidden" && (d.intent === "image-crop" || d.intent === "mask-shape")) return true;
		if (descendantHasCrop(child)) return true;
	}
	return false;
}
function classifyInferred(node, isRoot) {
	if (isRoot || node.isPageRoot) return decision("hidden", "viewport", "strong", ["root-viewport"]);
	const reasons = noExplicit([]);
	if (isCompositeImage(node)) return decision("visible", "composite-image", "strong", withReason(reasons, "stage-composite-image"));
	if (hasEffectOverflowSignal(node)) return decision("visible", "effect-overflow", "strong", withReason(reasons, "box-shadow-extends-outside-bounds"));
	const children = node.children ?? [];
	let ignoredSuppositional = false;
	let visualReasons;
	let directChildrenInside = children.length > 0;
	for (const child of children) {
		const evidence = overflowEvidence(node, child);
		if (!hasOverflow(evidence)) continue;
		directChildrenInside = false;
		if (isSuppositional(child)) {
			ignoredSuppositional = true;
			continue;
		}
		const directReasons = [...reasons, ...overflowReasons(evidence)];
		if (hasImageCropSignal(child)) return decision("hidden", hasMaskSignal(node) ? "mask-shape" : "image-crop", "strong", withReason(directReasons, "child-background-image-overflows-parent"));
		if (!visualReasons || visualOverflowSignal(node, child)) {
			visualReasons = directReasons;
			if (visualOverflowSignal(node, child)) visualReasons = withReason(visualReasons, "visual-composition-overflow");
		}
	}
	if (visualReasons) return decision("visible", "visual-overflow", "strong", visualReasons);
	let fallbackReasons = reasons;
	if (ignoredSuppositional) fallbackReasons = withReason(fallbackReasons, "suppositional-ignored");
	if (descendantHasCrop(node)) fallbackReasons = withReason(fallbackReasons, "descendant-overflow-not-bubbled");
	if (directChildrenInside) return decision("visible", "normal-container", "weak", withReason(fallbackReasons, "direct-children-inside-parent"));
	return decision("visible", "unknown", "fallback", withReason(fallbackReasons, "fallback-visible"));
}
function annotateClipDecisions(root) {
	const walk = (node, isRoot) => {
		node.children?.forEach((child) => walk(child, false));
		node.clipDecision = existingExplicitDecision(node) ?? explicitFieldDecision(node) ?? classifyInferred(node, isRoot);
	};
	walk(root, true);
	return root;
}
//#endregion
//#region src/pipeline/shared/tree-metadata.ts
function fillTreeMetadata(root, order) {
	let counter = 0;
	const walk = (node, depth, zIndex, parentId) => {
		node.depth = depth;
		node.zIndex = zIndex;
		node.renderOrder = counter++;
		if (order === "figma" && node.sourcePaintOrder === void 0) node.sourcePaintOrder = node.renderOrder;
		node.parentId = parentId;
		const kids = node.children;
		if (!kids || kids.length === 0) return;
		if (order === "figma") for (let i = kids.length - 1; i >= 0; i--) {
			const siblingZ = kids.length - 1 - i;
			walk(kids[i], depth + 1, siblingZ, node.id);
		}
		else for (let i = 0; i < kids.length; i++) walk(kids[i], depth + 1, i, node.id);
	};
	walk(root, 0, 0, void 0);
}
function fillFigmaOrderTreeMetadata(root) {
	fillTreeMetadata(root, "figma");
}
function fillHtmlOrderTreeMetadata$1(root) {
	fillTreeMetadata(root, "html");
}
function effectiveLayerAlpha(node) {
	return clamp01((node.style?.opacity ?? 1) * colorAlpha(node.style?.color));
}
function colorAlpha(value) {
	if (!value) return 1;
	const rgba = value.match(/rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*([\d.]+%?))?\s*\)/i);
	if (rgba) {
		if (rgba[1] === void 0) return 1;
		return parseAlphaToken(rgba[1]);
	}
	if (value.trim().match(/^#[0-9a-fA-F]{8}$/)) return parseInt(value.slice(7, 9), 16) / 255;
	return 1;
}
function parseAlphaToken(value) {
	const n = Number.parseFloat(value);
	if (!Number.isFinite(n)) return 1;
	return clamp01(value.trim().endsWith("%") ? n / 100 : n);
}
function clamp01(value) {
	return Math.max(0, Math.min(1, value));
}
function boxOf(node) {
	return {
		x: node.geometry.x,
		y: node.geometry.y,
		width: node.geometry.width,
		height: node.geometry.height
	};
}
function axisVisibleRatio(pos, len, vpPos, vpLen) {
	if (len <= 0) return 1;
	const lo = Math.max(pos, vpPos);
	const overlap = Math.min(pos + len, vpPos + vpLen) - lo;
	return overlap <= 0 ? 0 : overlap / len;
}
function viewportAxisVisibility(node, viewport) {
	const b = boxOf(node);
	return {
		widthRatio: axisVisibleRatio(b.x, b.width, viewport.x, viewport.width),
		heightRatio: axisVisibleRatio(b.y, b.height, viewport.y, viewport.height)
	};
}
function pruneIds(node, ids) {
	if (!node.children) return;
	node.children = node.children.filter((c) => !ids.has(c.id));
	node.children.forEach((c) => pruneIds(c, ids));
}
/**
* 删除被页面视口横向裁剪到 widthRatio < VIEWPORT_VISIBILITY_THRESHOLD 且
* heightRatio >= VIEWPORT_HEIGHT_KEEP_RATIO 的非根节点（连子树）。
* 返回删除数量。典型用法：放在 cullOccludedNodes 之后。
*/
function cullViewportClippedNodes(root) {
	const viewport = boxOf(root);
	const doomed = /* @__PURE__ */ new Set();
	const walk = (node) => {
		for (const child of node.children ?? []) {
			if (!subtreeHasProtectedMark(child)) {
				const { widthRatio, heightRatio } = viewportAxisVisibility(child, viewport);
				if (widthRatio > 0 && widthRatio < .15 && heightRatio >= .9) {
					doomed.add(child.id);
					continue;
				}
			}
			walk(child);
		}
	};
	walk(root);
	if (doomed.size === 0) return 0;
	pruneIds(root, doomed);
	return doomed.size;
}
//#endregion
//#region src/pipeline/shared/geometry.ts
function intersectionArea(a, b) {
	const x1 = Math.max(a.x, b.x);
	const y1 = Math.max(a.y, b.y);
	const x2 = Math.min(a.x + a.width, b.x + b.width);
	const y2 = Math.min(a.y + a.height, b.y + b.height);
	if (x2 <= x1 || y2 <= y1) return 0;
	return (x2 - x1) * (y2 - y1);
}
function boundingBoxArea(b) {
	return Math.max(0, b.width) * Math.max(0, b.height);
}
function minAreaOverlapRatio(a, b) {
	const minArea = Math.min(boundingBoxArea(a), boundingBoxArea(b));
	if (minArea === 0) return 0;
	return intersectionArea(a, b) / minArea;
}
function nodesBbox$1(nodes) {
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const n of nodes) {
		const g = n.geometry;
		if (g.x < minX) minX = g.x;
		if (g.y < minY) minY = g.y;
		if (g.x + g.width > maxX) maxX = g.x + g.width;
		if (g.y + g.height > maxY) maxY = g.y + g.height;
	}
	return {
		x: minX,
		y: minY,
		width: maxX - minX,
		height: maxY - minY
	};
}
//#endregion
//#region src/parsers/octo/component-image-overrides.ts
var COMPONENT_IMAGE_OVERRIDES = [{
	name: "Top Banner",
	componentKey: "4ed76036ca4d91523d0c8ef981226e651d6ff2ca",
	imageRole: "background",
	imageSource: "composite",
	collapseToImage: true,
	geometry: "self-width-subtree-height"
}, {
	name: "#illustration_Templates/Design size/Phone/Port",
	symbolKey: "0622dae8e6496f3632ff4da87c8c6c696c50c875",
	imageRole: "background",
	imageSource: "composite",
	collapseToImage: true,
	geometry: "self-width-subtree-height"
}];
function componentKeyOf(componentInstance) {
	if (!componentInstance || typeof componentInstance !== "object") return void 0;
	const key = componentInstance.component_key;
	return typeof key === "string" ? key : void 0;
}
function symbolKeyOf(componentInstance) {
	if (!componentInstance || typeof componentInstance !== "object") return void 0;
	const key = componentInstance.symbol_key;
	return typeof key === "string" ? key : void 0;
}
function componentImageOverride(raw) {
	const componentKey = componentKeyOf(raw.component_instance);
	const symbolKey = symbolKeyOf(raw.component_instance);
	if (!componentKey && !symbolKey) return void 0;
	return COMPONENT_IMAGE_OVERRIDES.find((override) => raw.name === override.name && (override.componentKey === void 0 || componentKey === override.componentKey) && (override.symbolKey === void 0 || symbolKey === override.symbolKey));
}
//#endregion
//#region src/parsers/octo/new-format.ts
function colorToCSS(c) {
	if (!c) return void 0;
	const toHex = (n) => Math.round(n).toString(16).padStart(2, "0");
	if (c.alpha >= 1) return `#${toHex(c.red)}${toHex(c.green)}${toHex(c.blue)}`;
	return `rgba(${Math.round(c.red)}, ${Math.round(c.green)}, ${Math.round(c.blue)}, ${c.alpha})`;
}
function isGradient(bg) {
	return !!bg && (bg.type === "linear" || bg.type === "radial" || bg.type === "angular");
}
function resolveAsset(ref, assets) {
	if (!ref) return void 0;
	const m = ref.match(/^\$(\d+)$/);
	if (!m) return void 0;
	return assets[Number(m[1])];
}
function gradientAngle(g) {
	const [cx, cy] = g.center_point;
	const [lx, ly] = g.long_axis_point;
	const dx = lx - cx;
	const dy = ly - cy;
	return ((Math.atan2(dy, dx) * 180 / Math.PI + 90) % 360 + 360) % 360;
}
function gradientToCSS(g) {
	const stops = g.gradient_range.map((s) => `${colorToCSS(s.color)} ${(s.ratio * 100).toFixed(1)}%`).join(", ");
	if (g.type === "linear") return `linear-gradient(${gradientAngle(g).toFixed(1)}deg, ${stops})`;
	if (g.type === "radial") return `radial-gradient(${stops})`;
	return `conic-gradient(${stops})`;
}
function buildBackground(s, assets) {
	const out = {};
	const bg = s.background_color;
	const imgRef = s.background_image;
	const url = resolveAsset(imgRef, assets);
	const imagePart = url ? `url("${url}")` : void 0;
	const gradientPart = bg && isGradient(bg) ? gradientToCSS(bg) : void 0;
	const colorPart = bg && !isGradient(bg) ? colorToCSS(bg) : void 0;
	if (gradientPart && imagePart) out.backgroundImage = `${gradientPart}, ${imagePart}`;
	else if (gradientPart) out.backgroundImage = gradientPart;
	else if (imagePart) {
		out.backgroundImage = imagePart;
		if (colorPart) out.backgroundColor = colorPart;
	} else if (colorPart) out.backgroundColor = colorPart;
	if (imagePart) {
		if (s.background_position) out.backgroundPosition = s.background_position;
		if (s.background_repeat) out.backgroundRepeat = s.background_repeat;
		if (s.background_size) out.backgroundSize = s.background_size;
	}
	return out;
}
function buildBorder(s) {
	if (!s.border || s.border.length === 0) return {};
	const widths = {
		top: 0,
		right: 0,
		bottom: 0,
		left: 0
	};
	const styles = {
		top: "",
		right: "",
		bottom: "",
		left: ""
	};
	const colors = {
		top: "currentColor",
		right: "currentColor",
		bottom: "currentColor",
		left: "currentColor"
	};
	for (const b of s.border) {
		widths[b.position] = b.width;
		styles[b.position] = b.style || "solid";
		colors[b.position] = colorToCSS(b.color) ?? "currentColor";
	}
	if (widths.top === widths.right && widths.right === widths.bottom && widths.bottom === widths.left && styles.top === styles.right && styles.right === styles.bottom && styles.bottom === styles.left && colors.top === colors.right && colors.right === colors.bottom && colors.bottom === colors.left) return { border: `${widths.top}px ${styles.top || "solid"} ${colors.top}` };
	const out = {};
	if (widths.top) out.borderTop = `${widths.top}px ${styles.top || "solid"} ${colors.top}`;
	if (widths.right) out.borderRight = `${widths.right}px ${styles.right || "solid"} ${colors.right}`;
	if (widths.bottom) out.borderBottom = `${widths.bottom}px ${styles.bottom || "solid"} ${colors.bottom}`;
	if (widths.left) out.borderLeft = `${widths.left}px ${styles.left || "solid"} ${colors.left}`;
	return out;
}
function buildCornerRadius(s) {
	const r = s.round_corner;
	if (!r) return void 0;
	const [tl, tr, br, bl] = r;
	if (tl === 0 && tr === 0 && br === 0 && bl === 0) return void 0;
	if (tl === tr && tr === br && br === bl) return `${tl}px`;
	return `${tl}px ${tr}px ${br}px ${bl}px`;
}
function buildBoxShadow(s) {
	if (!s.shadow || s.shadow.length === 0) return void 0;
	return s.shadow.map((sh) => {
		const inset = sh.type === "inner" ? "inset " : "";
		const color = colorToCSS(sh.color) ?? "rgba(0,0,0,1)";
		return `${inset}${sh.x}px ${sh.y}px ${sh.blur}px ${sh.spread ?? 0}px ${color}`;
	}).join(", ");
}
function buildTextShadow(s) {
	const shadows = s.shadow?.filter((sh) => sh.type !== "inner") ?? [];
	if (shadows.length === 0) return void 0;
	return shadows.map((sh) => {
		const color = colorToCSS(sh.color) ?? "rgba(0,0,0,1)";
		return `${sh.x}px ${sh.y}px ${sh.blur}px ${color}`;
	}).join(", ");
}
function buildFilter(s) {
	if (!s.filter || s.filter.length === 0) return {};
	const layer = [];
	const backdrop = [];
	for (const f of s.filter) {
		const part = `blur(${f.value}px)`;
		if (f.type === "background") backdrop.push(part);
		else layer.push(part);
	}
	const out = {};
	if (layer.length) out.filter = layer.join(" ");
	if (backdrop.length) out.backdropFilter = backdrop.join(" ");
	return out;
}
function buildStyle(raw, assets) {
	const s = raw.style;
	if (!s) return void 0;
	const isText = raw.type === "TEXT";
	const style = {};
	if (!isText) Object.assign(style, buildBackground(s, assets));
	if (isText) {
		if (s.font_color) style.color = colorToCSS(s.font_color);
		if (s.font_size !== void 0) style.fontSize = `${s.font_size}px`;
		if (s.font_weight !== void 0) style.fontWeight = s.font_weight;
		if (s.line_height !== void 0) style.lineHeight = `${s.line_height}px`;
		if (s.letter_spacing !== void 0) style.letterSpacing = `${s.letter_spacing}px`;
		if (s.text_align_horizontal) style.textAlign = s.text_align_horizontal;
		if (s.text_align_vertical) style.verticalAlign = s.text_align_vertical === "center" ? "middle" : s.text_align_vertical;
	}
	const br = buildCornerRadius(s);
	if (br) style.borderRadius = br;
	Object.assign(style, buildBorder(s));
	const shadow = isText ? buildTextShadow(s) : buildBoxShadow(s);
	if (shadow) if (isText) style.textShadow = shadow;
	else style.boxShadow = shadow;
	Object.assign(style, buildFilter(s));
	if (s.opacity !== void 0 && s.opacity !== 1) style.opacity = s.opacity;
	return Object.keys(style).length > 0 ? style : void 0;
}
var VALID_ALIGNS = new Set([
	"MIN",
	"CENTER",
	"MAX",
	"SPACE_BETWEEN",
	"BASELINE"
]);
function normalizeAlign(v) {
	if (!v) return void 0;
	return VALID_ALIGNS.has(v) ? v : void 0;
}
function normalizeSizing(v) {
	if (!v) return void 0;
	if (v === "FIXED") return "FIXED";
	if (v === "RESIZE_TO_FIT" || v === "HUG" || v === "AUTO") return "HUG";
	if (v === "FILL" || v === "STRETCH") return "FILL";
}
function parseDesignLayout(raw) {
	if (!raw) return void 0;
	try {
		return JSON.parse(raw);
	} catch {
		return;
	}
}
function extractHints(raw, componentName) {
	const dl = parseDesignLayout(raw.extend?.design_layout);
	let autoLayout;
	let autoLayoutChild;
	if (dl) {
		if (dl.stackMode === "HORIZONTAL" || dl.stackMode === "VERTICAL") {
			const hasPad = dl.stackPaddingTop || dl.stackPaddingRight || dl.stackPaddingBottom || dl.stackPaddingLeft;
			autoLayout = {
				mode: dl.stackMode,
				primaryAlign: normalizeAlign(dl.stackPrimaryAlignItems),
				counterAlign: normalizeAlign(dl.stackCounterAlignItems),
				gap: dl.stackSpacing,
				padding: hasPad ? {
					top: dl.stackPaddingTop ?? 0,
					right: dl.stackPaddingRight ?? 0,
					bottom: dl.stackPaddingBottom ?? 0,
					left: dl.stackPaddingLeft ?? 0
				} : void 0,
				wrap: dl.stackWrap === "WRAP" ? true : void 0,
				primarySizing: normalizeSizing(dl.stackPrimarySizing),
				counterSizing: normalizeSizing(dl.stackCounterSizing)
			};
		}
		const childPrimary = normalizeSizing(dl.stackChildPrimarySizing);
		const childCounter = normalizeSizing(dl.stackChildCounterSizing);
		if (dl.autoLayoutAbsolutePos || childPrimary || childCounter) autoLayoutChild = {
			absolute: dl.autoLayoutAbsolutePos || void 0,
			primarySizing: childPrimary,
			counterSizing: childCounter
		};
	}
	const hints = { componentName };
	if (autoLayout) hints.autoLayout = autoLayout;
	if (autoLayoutChild) hints.autoLayoutChild = autoLayoutChild;
	return hints;
}
function inferComponentName(type) {
	if (type === "TEXT") return "span";
	if (type === "VECTOR" || type === "BOOLEAN_OPERATION") return "svg";
	return "div";
}
function isImageRole(value) {
	return value === "content" || value === "background";
}
function isImageSource(value) {
	return value === "raster" || value === "vector" || value === "composite" || value === "icon-font";
}
var ICON_FONT_FAMILIES$1 = new Set([
	"HM Symbol",
	"Material Icons",
	"Material Symbols",
	"iconfont",
	"icomoon",
	"Font Awesome"
]);
function explicitImageInfo(raw) {
	const role = isImageRole(raw.extend?.image_role) ? raw.extend.image_role : void 0;
	const source = isImageSource(raw.extend?.image_source) ? raw.extend.image_source : void 0;
	return role || source ? {
		role,
		source
	} : void 0;
}
function explicitBackgroundLayer(raw) {
	const layer = raw.extend?.background_layer;
	if (!layer || typeof layer !== "object") return void 0;
	const score = typeof layer.score === "number" ? layer.score : void 0;
	const containedNodeIds = Array.isArray(layer.contained_node_ids) ? layer.contained_node_ids.filter((id) => typeof id === "string") : void 0;
	const reasons = Array.isArray(layer.reasons) ? layer.reasons.filter((reason) => typeof reason === "string") : void 0;
	if (score === void 0 || !containedNodeIds || !reasons) return void 0;
	return {
		score,
		containedNodeIds,
		reasons
	};
}
function explicitVirtualContainer(raw) {
	const container = raw.extend?.virtual_container;
	if (!container || typeof container !== "object") return void 0;
	const wrappedNodeIds = Array.isArray(container.wrapped_node_ids) ? container.wrapped_node_ids.filter((id) => typeof id === "string") : void 0;
	const reason = typeof container.reason === "string" ? container.reason : void 0;
	if (!wrappedNodeIds || !reason) return void 0;
	if (container.kind === "background-container") {
		const backgroundNodeId = typeof container.background_node_id === "string" ? container.background_node_id : void 0;
		if (!backgroundNodeId) return void 0;
		return {
			kind: "background-container",
			backgroundNodeId,
			wrappedNodeIds,
			reason
		};
	}
	if (container.kind === "row-container" || container.kind === "column-container" || container.kind === "center-wrapper") return {
		kind: container.kind,
		wrappedNodeIds,
		reason
	};
}
function explicitLayout(raw) {
	const layout = raw.extend?.layout;
	if (!layout || typeof layout !== "object") return void 0;
	if (layout.mode === "flex" && (layout.direction === "row" || layout.direction === "column")) {
		const result = {
			mode: "flex",
			direction: layout.direction
		};
		if (layout.padding && typeof layout.padding === "object" && Number.isFinite(layout.padding.top) && Number.isFinite(layout.padding.right) && Number.isFinite(layout.padding.bottom) && Number.isFinite(layout.padding.left)) result.padding = {
			top: layout.padding.top,
			right: layout.padding.right,
			bottom: layout.padding.bottom,
			left: layout.padding.left
		};
		if (typeof layout.gap === "number" && Number.isFinite(layout.gap)) result.gap = layout.gap;
		if (typeof layout.align === "string" && (layout.align === "flex-start" || layout.align === "center" || layout.align === "flex-end")) result.align = layout.align;
		if (Array.isArray(layout.hintConflicts) && layout.hintConflicts.length > 0) result.hintConflicts = layout.hintConflicts;
		return result;
	}
	if (layout.mode === "absolute") {
		const result = { mode: "absolute" };
		if (Array.isArray(layout.hintConflicts) && layout.hintConflicts.length > 0) result.hintConflicts = layout.hintConflicts;
		return result;
	}
}
var CSS_OVERFLOWS = new Set(["hidden", "visible"]);
var CLIP_CONFIDENCES = new Set([
	"explicit",
	"strong",
	"weak",
	"fallback"
]);
var CLIPPING_INTENTS = new Set([
	"viewport",
	"image-crop",
	"mask-shape",
	"visual-overflow",
	"effect-overflow",
	"composite-image",
	"normal-container",
	"unknown"
]);
function explicitClipDecision(raw) {
	const decision = raw.extend?.clip_decision;
	if (!decision || typeof decision !== "object") return void 0;
	const overflow = CSS_OVERFLOWS.has(decision.overflow) ? decision.overflow : void 0;
	const intent = CLIPPING_INTENTS.has(decision.intent) ? decision.intent : void 0;
	const confidence = CLIP_CONFIDENCES.has(decision.confidence) ? decision.confidence : void 0;
	const reasons = Array.isArray(decision.reasons) ? decision.reasons.filter((reason) => typeof reason === "string") : void 0;
	if (!overflow || !intent || !confidence || !reasons || reasons.length === 0) return void 0;
	return {
		overflow,
		intent,
		confidence,
		reasons
	};
}
function inferImageInfo(raw) {
	const explicit = explicitImageInfo(raw);
	if (explicit) return explicit;
	const componentOverride = componentImageOverride(raw);
	if (componentOverride) return {
		role: componentOverride.imageRole,
		source: componentOverride.imageSource,
		collapseToImage: componentOverride.collapseToImage,
		geometry: componentOverride.geometry
	};
	if (raw.type === "VECTOR" || raw.type === "BOOLEAN_OPERATION") return {
		role: "content",
		source: "vector"
	};
	if (raw.extend?.vector_merge) return {
		role: "content",
		source: "vector"
	};
	if (raw.extend?.icon) return {
		role: "content",
		source: "vector"
	};
	if (raw.extend?.vector_shape) return {
		role: "content",
		source: "vector"
	};
	if (raw.type === "TEXT" && raw.style?.font_family && ICON_FONT_FAMILIES$1.has(raw.style.font_family)) return {
		role: "content",
		source: "icon-font"
	};
	if (raw.style?.background_image) return {
		role: (raw.children?.filter((c) => c.type !== "SUPPOSITIONAL") ?? []).length > 0 ? "background" : "content",
		source: "raster"
	};
}
function resolveType(raw) {
	if (raw.component_instance) return "INSTANCE";
	return raw.type;
}
function rawSubtreeBox(raw) {
	let minX = raw.box.x;
	let minY = raw.box.y;
	let maxX = raw.box.x + raw.box.width;
	let maxY = raw.box.y + raw.box.height;
	for (const child of raw.children ?? []) {
		const childBox = rawSubtreeBox(child);
		minX = Math.min(minX, childBox.x);
		minY = Math.min(minY, childBox.y);
		maxX = Math.max(maxX, childBox.x + childBox.width);
		maxY = Math.max(maxY, childBox.y + childBox.height);
	}
	return {
		x: minX,
		y: minY,
		width: maxX - minX,
		height: maxY - minY
	};
}
function clampBoxToBounds(box, bounds) {
	const x1 = Math.max(box.x, bounds.x);
	const y1 = Math.max(box.y, bounds.y);
	const x2 = Math.min(box.x + box.width, bounds.x + bounds.width);
	const y2 = Math.min(box.y + box.height, bounds.y + bounds.height);
	return {
		x: x1,
		y: y1,
		width: Math.max(0, x2 - x1),
		height: Math.max(0, y2 - y1)
	};
}
function geometryBoxForImageInfo(raw, imageInfo, rootBox) {
	if (imageInfo?.geometry === "subtree-union") return clampBoxToBounds(rawSubtreeBox(raw), rootBox);
	if (imageInfo?.geometry === "self-width-subtree-height") {
		const subtreeBox = rawSubtreeBox(raw);
		const top = Math.min(raw.box.y, subtreeBox.y);
		const bottom = Math.max(raw.box.y + raw.box.height, subtreeBox.y + subtreeBox.height);
		return clampBoxToBounds({
			x: raw.box.x,
			y: top,
			width: raw.box.width,
			height: bottom - top
		}, rootBox);
	}
	return raw.box;
}
function isPlainRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringField(value) {
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
function extractComponentInstance(value) {
	if (!isPlainRecord(value)) return void 0;
	const componentKey = stringField(value.component_key);
	const instanceName = stringField(value.instance_name);
	if (!componentKey && !instanceName) return void 0;
	return {
		...componentKey ? { component_key: componentKey } : {},
		...instanceName ? { instance_name: instanceName } : {}
	};
}
function extractPixsoNodeId(extend) {
	const pixso = extend?.pixso;
	if (!isPlainRecord(pixso)) return void 0;
	return stringField(pixso.guid);
}
function isPixsoInstanceSnapshot(extend, imageRole, imageSource) {
	const pixso = extend?.pixso;
	return imageRole === "content" && imageSource === "composite" && isPlainRecord(pixso) && pixso.source_type === "INSTANCE";
}
function convertNode(raw, assets, opts, rootBox) {
	const resolvedType = resolveType(raw);
	const imageInfo = opts.skipImageDetection ? explicitImageInfo(raw) : inferImageInfo(raw);
	const imageRole = imageInfo?.role;
	const imageSource = imageInfo?.source;
	const backgroundLayer = explicitBackgroundLayer(raw);
	const virtualContainer = explicitVirtualContainer(raw);
	const layout = explicitLayout(raw);
	const clipDecision = explicitClipDecision(raw);
	const isImage = imageRole === "content" || imageInfo?.collapseToImage === true;
	const type = isImage ? "IMAGE" : resolvedType;
	const isText = type === "TEXT";
	const geometryBox = geometryBoxForImageInfo(raw, imageInfo, rootBox);
	const imageUrl = resolveAsset(raw.style?.background_image, assets);
	const pixsoNodeId = extractPixsoNodeId(raw.extend);
	const pixsoInstanceSnapshot = isPixsoInstanceSnapshot(raw.extend, imageRole, imageSource);
	const explicitlyNonOpaqueImage = raw.extend?.image_opaque === false;
	return {
		id: raw.key,
		name: raw.name,
		type,
		geometry: {
			x: geometryBox.x,
			y: geometryBox.y,
			width: geometryBox.width,
			height: geometryBox.height,
			rotation: raw.style?.rotation_angle
		},
		style: buildStyle(raw, assets),
		characters: isText ? raw.content : void 0,
		componentInstance: extractComponentInstance(raw.component_instance),
		hints: extractHints(raw, inferComponentName(type)),
		extend: raw.extend,
		layout: layout || void 0,
		clipDecision,
		imageRole,
		imageSource,
		imageUrl,
		...(imageUrl || pixsoInstanceSnapshot) && pixsoNodeId ? { imageResourceNodeId: pixsoNodeId } : {},
		...explicitlyNonOpaqueImage || pixsoInstanceSnapshot ? { imageOpaque: false } : {},
		backgroundLayer,
		virtualContainer,
		children: isImage ? void 0 : raw.children?.map((c) => convertNode(c, assets, opts, rootBox)),
		depth: 0,
		zIndex: 0,
		renderOrder: 0
	};
}
function parseNewFormat(raw, opts = {}) {
	if (!raw.content || raw.content.length === 0) throw new Error("parseNewFormat: content 为空");
	const assets = Array.isArray(raw.assets) ? raw.assets : [];
	const root = convertNode(raw.content[0], assets, opts, raw.content[0].box);
	root.isPageRoot = true;
	return root;
}
//#endregion
//#region src/parsers/octo/input.ts
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isRawNodeLike(value) {
	if (!isRecord(value)) return false;
	return typeof value.key === "string" && isRecord(value.box) && isRecord(value.style);
}
function isRawNewRoot(value) {
	if (!isRecord(value) || !Array.isArray(value.content)) return false;
	if (value.content.length === 0) return true;
	return isRawNodeLike(value.content[0]);
}
function validateRaw(raw) {
	if (isPixsoRefsRoot(raw)) return convertPixsoRefsToRawNewRoot(raw);
	if (isPixsoDesignRoot(raw)) return convertPixsoToRawNewRoot(raw);
	if (!raw || typeof raw !== "object" || !Array.isArray(raw.content)) throw new Error("parseDesign: 输入不是有效的设计稿数据（期望 Octo { assets, content: [...] }、Pixso { pixTreeNodes: [...] } 或 Pixso refs { roots, refsIndex }）");
	return raw;
}
//#endregion
//#region src/pipeline/parse-raw/index.ts
/**
* 唯一输入分派：所有受支持输入先规范化为 RawNewRoot（validateRaw，居 parsers/octo），
* 再由同一个 parseNewFormat 入口构造 DesignNode。Pixso refs 不再直转 DesignNode。
*/
function parseInputToDesignNode(raw, options = {}) {
	return parseNewFormat(validateRaw(raw), options);
}
//#endregion
//#region src/pipeline/stage2-node-converge/index.ts
function isRefsOccurrence(node) {
	const pixso = node.extend?.pixso;
	return typeof pixso === "object" && pixso !== null && !Array.isArray(pixso) && pixso.source_format === "refs" && typeof pixso.guid === "string";
}
function occurrenceSnapshotStyle(style) {
	if (!style?.backgroundImage) return void 0;
	return {
		backgroundImage: style.backgroundImage,
		...style.backgroundSize ? { backgroundSize: style.backgroundSize } : {},
		...style.backgroundPosition ? { backgroundPosition: style.backgroundPosition } : {},
		...style.backgroundRepeat ? { backgroundRepeat: style.backgroundRepeat } : {}
	};
}
function markAsImage(node, imageSource = "composite", opaque = true) {
	if (imageSource === "composite" && isRefsOccurrence(node)) node.style = occurrenceSnapshotStyle(node.style);
	node.imageRole = "content";
	node.imageSource = imageSource;
	node.type = "IMAGE";
	if (!opaque) node.imageOpaque = false;
	node.children = void 0;
}
var SHAPE_OR_IMAGE_TYPES = new Set([
	"IMAGE",
	"VECTOR",
	"BOOLEAN_OPERATION",
	"ELLIPSE",
	"RECTANGLE",
	"LINE",
	"SUPPOSITIONAL"
]);
var CONTAINER_TYPES = new Set([
	"FRAME",
	"GROUP",
	"INSTANCE",
	"COMPONENT"
]);
var MIN_SHAPE_IMAGE_RATIO_FOR_TEXT_SUBTREE = .8;
var MIN_COMPOSITE_OVERLAP_RATIO = .05;
function isPixsoSyntheticNode(node) {
	const pixso = node.extend?.pixso;
	return typeof pixso === "object" && pixso !== null && !Array.isArray(pixso) && (pixso.synthetic_root === true || pixso.source_format === "refs" && typeof pixso.synthetic_id === "string");
}
function checkSubtree(node) {
	if (node.type === "TEXT") {
		if (isIconFontText(node)) return {
			textCount: 0,
			hasOther: false,
			shapeImageCount: 1,
			contentCount: 1
		};
		return {
			textCount: 1,
			hasOther: false,
			shapeImageCount: 0,
			contentCount: 1
		};
	}
	if (SHAPE_OR_IMAGE_TYPES.has(node.type)) return {
		textCount: 0,
		hasOther: false,
		shapeImageCount: 1,
		contentCount: 1
	};
	if (!CONTAINER_TYPES.has(node.type)) return {
		textCount: 0,
		hasOther: true,
		shapeImageCount: 0,
		contentCount: 0
	};
	let textCount = 0;
	let hasOther = false;
	let shapeImageCount = node.imageRole || node.imageUrl ? 1 : 0;
	let contentCount = node.imageRole || node.imageUrl ? 1 : 0;
	for (const c of node.children ?? []) {
		const r = checkSubtree(c);
		textCount += r.textCount;
		if (r.hasOther) hasOther = true;
		shapeImageCount += r.shapeImageCount;
		contentCount += r.contentCount;
	}
	return {
		textCount,
		hasOther,
		shapeImageCount,
		contentCount
	};
}
function hasHighShapeImageRatio(info) {
	if (info.contentCount === 0) return false;
	return info.shapeImageCount / info.contentCount >= MIN_SHAPE_IMAGE_RATIO_FOR_TEXT_SUBTREE;
}
function findFirstSemanticTextWithParent(node, parent) {
	if (node.type === "TEXT" && !isIconFontText(node)) return {
		text: node,
		parent
	};
	for (const c of node.children ?? []) {
		const found = findFirstSemanticTextWithParent(c, node);
		if (found) return found;
	}
}
function hasInstanceOwnedSemanticText(node) {
	const found = findFirstSemanticTextWithParent(node);
	return found?.parent?.type === "INSTANCE" && bboxOverlap(node.geometry, found.text.geometry);
}
function markShapeOnlySubtrees(node) {
	if (node.imageRole) return;
	if (node.imageUrl) return;
	if (node.isPageRoot) {
		node.children?.forEach(markShapeOnlySubtrees);
		return;
	}
	if (isPixsoSyntheticNode(node)) {
		node.children?.forEach(markShapeOnlySubtrees);
		return;
	}
	if (!CONTAINER_TYPES.has(node.type)) {
		node.children?.forEach(markShapeOnlySubtrees);
		return;
	}
	const kids = node.children ?? [];
	const looksLikeGrid = kids.length >= 2 && !hasAnySubstantialOverlap(kids);
	const info = checkSubtree(node);
	if (!kids.some((k) => subtreeHasProtectedMark(k, true)) && !info.hasOther && !looksLikeGrid) {
		if (info.textCount === 0) {
			if (info.contentCount > 0 || hasBaseSurfaceStyle(node) || hasShadowStyle(node)) {
				markAsImage(node, "composite", !subtreeHasTransparency(node));
				return;
			}
		}
		if (info.textCount === 1) {
			if (!kids.some((k) => k.type === "TEXT") && !hasInstanceOwnedSemanticText(node) && hasHighShapeImageRatio(info)) {
				markAsImage(node, "composite", !subtreeHasTransparency(node));
				return;
			}
		}
	}
	node.children?.forEach(markShapeOnlySubtrees);
}
function bboxOverlap(a, b) {
	return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
function mostlyInside(inner, outer) {
	const innerArea = boundingBoxArea(inner);
	if (innerArea === 0) return false;
	return intersectionArea(inner, outer) / innerArea >= .8;
}
function hasAnySubstantialOverlap(nodes) {
	for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) if (minAreaOverlapRatio(nodes[i].geometry, nodes[j].geometry) >= MIN_COMPOSITE_OVERLAP_RATIO) return true;
	return false;
}
function hasBaseSurfaceStyle(node) {
	const s = node.style;
	if (!s) return false;
	return Boolean(s.backgroundColor || s.backgroundImage || s.border || s.borderTop || s.borderRight || s.borderBottom || s.borderLeft || s.borderRadius);
}
function hasShadowStyle(node) {
	return Boolean(node.style?.boxShadow);
}
function isBackgroundLayerCandidate(node) {
	if ((node.children?.length ?? 0) > 0) return false;
	if (!(node.type === "IMAGE" || SHAPE_OR_IMAGE_TYPES.has(node.type))) return false;
	if (!hasBaseSurfaceStyle(node)) return false;
	const area = boundingBoxArea(node.geometry);
	const regularSurface = node.geometry.width >= 64 && node.geometry.height >= 40 && area >= 4096;
	const compactHorizontalSurface = node.geometry.width >= 64 && node.geometry.height >= 28 && area >= 2304 && node.geometry.width / Math.max(node.geometry.height, 1) >= 1.5;
	return regularSurface || compactHorizontalSurface;
}
function hasSemanticText(node) {
	if (node.type === "TEXT" && !isIconFontText(node)) return true;
	return node.children?.some(hasSemanticText) ?? false;
}
function isSemanticSibling(node) {
	if (node.type === "TEXT") return !isIconFontText(node);
	if (node.type === "INSTANCE" || node.type === "COMPONENT") return true;
	if (node.type === "FRAME" || node.type === "GROUP") return hasSemanticText(node);
	return false;
}
function backgroundLayerScore(candidate, parent, index, contained) {
	let score = 0;
	const reasons = [];
	if (candidate.imageSource === "vector") {
		score += 1;
		reasons.push("vector-source");
	}
	if (hasBaseSurfaceStyle(candidate)) {
		score += 3;
		reasons.push("surface-style");
	}
	if (hasShadowStyle(candidate)) {
		score += 1;
		reasons.push("shadow-style");
	}
	if (boundingBoxArea(candidate.geometry) / Math.max(boundingBoxArea(parent.geometry), 1) >= .05) {
		score += 2;
		reasons.push("large-surface");
	}
	const kids = parent.children ?? [];
	if (kids.length > 1) {
		const bottomness = index / (kids.length - 1);
		if (bottomness >= .75) {
			score += 3;
			reasons.push("near-bottom-layer");
		} else if (bottomness >= .35) {
			score += 1;
			reasons.push("lower-layer");
		}
	}
	score += Math.min(5, contained.length);
	reasons.push(`contained-semantic:${contained.length}`);
	return {
		score,
		reasons
	};
}
function isBackgroundLayerMatch(containedCount, score, reasons) {
	if (containedCount >= 2) return score >= 8;
	return containedCount === 1 && score >= 9 && reasons.includes("near-bottom-layer");
}
function detectBackgroundLayers(node) {
	const kids = node.children;
	if (kids && kids.length > 0) {
		for (let i = 0; i < kids.length; i++) {
			const candidate = kids[i];
			if (candidate.backgroundLayer) continue;
			if (isBackgroundLayerCandidate(candidate)) {
				const contained = kids.slice(0, i).filter((sibling) => isSemanticSibling(sibling) && mostlyInside(sibling.geometry, candidate.geometry));
				if (contained.length >= 1) {
					const { score, reasons } = backgroundLayerScore(candidate, node, i, contained);
					if (isBackgroundLayerMatch(contained.length, score, reasons)) {
						candidate.imageRole = "background";
						candidate.backgroundLayer = {
							score,
							containedNodeIds: contained.map((sibling) => sibling.id),
							reasons
						};
					}
				}
			}
		}
		kids.forEach(detectBackgroundLayers);
	}
}
function mergeAllImageChildren(node) {
	node.children?.forEach(mergeAllImageChildren);
	if (node.isPageRoot) return;
	if (isPixsoSyntheticNode(node)) return;
	if (node.imageRole) return;
	if (node.imageUrl) return;
	if (node.type === "TEXT" || node.type === "COMPONENT") return;
	const kids = node.children ?? [];
	if (kids.length === 0) return;
	if (!kids.every((k) => k.type === "IMAGE")) return;
	if (!hasAnySubstantialOverlap(kids)) return;
	if (kids.some((k) => subtreeHasProtectedMark(k, true))) return;
	markAsImage(node, "composite", !subtreeHasTransparency(node));
}
var ICON_FONT_FAMILIES = new Set([
	"HM Symbol",
	"Material Icons",
	"Material Symbols",
	"iconfont",
	"icomoon",
	"Font Awesome"
]);
function hasPUACharacter(s) {
	if (!s) return false;
	for (const ch of s) {
		const cp = ch.codePointAt(0);
		if (cp === void 0) continue;
		if (cp >= 57344 && cp <= 63743 || cp >= 983040 && cp <= 1048573 || cp >= 1048576 && cp <= 1114109) return true;
	}
	return false;
}
function isIconFontText(node) {
	if (node.type !== "TEXT") return false;
	const ff = node.style?.fontFamily;
	if (ff && ICON_FONT_FAMILIES.has(ff)) return true;
	if (hasPUACharacter(node.characters)) return true;
	return false;
}
function markIconFontTexts(node, iconFontContent = /* @__PURE__ */ new Map()) {
	if (isIconFontText(node)) {
		if (node.characters !== void 0) iconFontContent.set(node.id, node.characters);
		node.type = "IMAGE";
		node.imageRole = "content";
		node.imageSource = "icon-font";
		node.characters = void 0;
	}
	node.children?.forEach((child) => markIconFontTexts(child, iconFontContent));
	return iconFontContent;
}
function collectRawIconFontContent(raw) {
	const iconFontContent = /* @__PURE__ */ new Map();
	const walk = (node) => {
		const content = node.content;
		if (node.type === "TEXT" && typeof content === "string" && (node.style?.font_family !== void 0 && ICON_FONT_FAMILIES.has(node.style.font_family) || hasPUACharacter(content) || node.extend?.image_source === "icon-font")) iconFontContent.set(node.key, content);
		node.children?.forEach(walk);
	};
	if (raw.content[0]) walk(raw.content[0]);
	return iconFontContent;
}
function isIconFontImage(node) {
	return node.type === "IMAGE" && node.imageSource === "icon-font";
}
function stripDuplicateOverlappingIconFontLayers(root, isKind, isSameContent) {
	const walk = (node) => {
		if (!node.children) return;
		node.children.forEach(walk);
		const keptOpaqueLayers = [];
		const survivors = [];
		for (const child of node.children) {
			const kind = isKind(child);
			if (kind && keptOpaqueLayers.some((kept) => isSameContent(kept, child) && minAreaOverlapRatio(kept.geometry, child.geometry) >= .95)) continue;
			survivors.push(child);
			if (kind && effectiveLayerAlpha(child) >= .5) keptOpaqueLayers.push(child);
		}
		node.children = survivors;
	};
	walk(root);
}
function isRedundantWrapper(node) {
	if (node.isPageRoot) return false;
	if (node.type === "TEXT" || node.type === "IMAGE") return false;
	if (node.children?.length !== 1) return false;
	if (node.geometry.rotation) return false;
	if (node.style && Object.keys(node.style).length > 0) return false;
	if (nodeHasProtectedMark(node)) return false;
	return true;
}
function flattenRedundantWrappers(node) {
	node.children?.forEach(flattenRedundantWrappers);
	if (!node.children) return;
	node.children = node.children.flatMap((c) => isRedundantWrapper(c) ? c.children ?? [] : [c]);
}
/**
* 节点收敛：
*   1. flattenRedundantWrappers —— 先打平无样式 wrapper，避免大容器包小图标被当成一整张图
*   2. markShapeOnlySubtrees     —— 子树只有形状 → IMAGE
*   3. icon-font TEXT 去重        —— 同位置叠放的图标字体 TEXT 收敛成一个
*   4. markIconFontTexts         —— HM Symbol 等图标字体 TEXT → IMAGE
*   5. icon-font IMAGE 去重       —— 转成 IMAGE 后再按同位置叠放去重一次
*   6. mergeAllImageChildren     —— 子节点全是 IMAGE 且互相重叠 → 合并
*   7. cullOccludedNodes         —— 移除被其他节点完全遮挡、永远看不见的节点
*   8. cullViewportClippedNodes  —— 移除被页面视口横向裁到只露窄缝的 peek card(宽度可见比 < 15% 且高度基本完整)
*   9. detectBackgroundLayers    —— 纯算法识别同级背景层候选
*   （收尾）重算树元数据
*/
function parseDesign(raw) {
	const validatedRaw = validateRaw(raw);
	const root = parseInputToDesignNode(validatedRaw);
	const iconFontContent = collectRawIconFontContent(validatedRaw);
	fillFigmaOrderTreeMetadata(root);
	flattenRedundantWrappers(root);
	markShapeOnlySubtrees(root);
	stripDuplicateOverlappingIconFontLayers(root, isIconFontText, (a, b) => a.characters === b.characters);
	markIconFontTexts(root, iconFontContent);
	stripDuplicateOverlappingIconFontLayers(root, isIconFontImage, (a, b) => {
		const aContent = iconFontContent.get(a.id);
		const bContent = iconFontContent.get(b.id);
		return aContent !== void 0 && aContent === bContent;
	});
	mergeAllImageChildren(root);
	cullOccludedNodes(root);
	cullViewportClippedNodes(root);
	detectBackgroundLayers(root);
	fillFigmaOrderTreeMetadata(root);
	return root;
}
//#endregion
//#region src/pipeline/stage3-background-container/index.ts
function sameBox(a, b, tolerance = 1) {
	return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance && Math.abs(a.width - b.width) <= tolerance && Math.abs(a.height - b.height) <= tolerance;
}
function isMaterializableBackgroundContainer(node) {
	return node.imageRole === "background" && !!node.backgroundLayer && node.virtualContainer?.kind !== "background-container" && (node.children?.length ?? 0) === 0;
}
function isBackgroundImageLayer(node) {
	return Boolean(node.imageUrl || node.style?.backgroundImage);
}
function canMaterializeFullCoverVisual(background) {
	return background.imageResourceNodeId === void 0 || isBackgroundImageLayer(background);
}
function shouldFoldFullCoverBackground(parent, background) {
	if (!sameBox(parent.geometry, background.geometry)) return false;
	return background.backgroundLayer.containedNodeIds.length === 1 || isBackgroundImageLayer(background);
}
function isFoldableFullCoverBackground(parent, background) {
	return isMaterializableBackgroundContainer(background) && shouldFoldFullCoverBackground(parent, background) && background.extend?.mask !== true && !background.geometry.rotation && (background.style?.opacity === void 0 || background.style.opacity === 1) && canMaterializeFullCoverVisual(background) && !parent.style?.backgroundImage;
}
function mergeFullCoverBackgroundIntoParent(parent, background) {
	const parentStyle = parent.style ?? {};
	const backgroundStyle = background.style ?? {};
	const copiesBackgroundImage = parentStyle.backgroundImage === void 0 && backgroundStyle.backgroundImage !== void 0;
	parent.style = {
		...parentStyle,
		...parentStyle.backgroundColor === void 0 && backgroundStyle.backgroundColor !== void 0 ? { backgroundColor: backgroundStyle.backgroundColor } : {},
		...parentStyle.backgroundImage === void 0 && backgroundStyle.backgroundImage !== void 0 ? { backgroundImage: backgroundStyle.backgroundImage } : {},
		...parentStyle.backgroundPosition === void 0 && backgroundStyle.backgroundPosition !== void 0 ? { backgroundPosition: backgroundStyle.backgroundPosition } : {},
		...parentStyle.backgroundRepeat === void 0 && backgroundStyle.backgroundRepeat !== void 0 ? { backgroundRepeat: backgroundStyle.backgroundRepeat } : {},
		...parentStyle.backgroundSize === void 0 && backgroundStyle.backgroundSize !== void 0 ? { backgroundSize: backgroundStyle.backgroundSize } : {},
		...parentStyle.borderRadius === void 0 && backgroundStyle.borderRadius !== void 0 ? { borderRadius: backgroundStyle.borderRadius } : {},
		...parentStyle.border === void 0 && backgroundStyle.border !== void 0 ? { border: backgroundStyle.border } : {},
		...parentStyle.borderTop === void 0 && backgroundStyle.borderTop !== void 0 ? { borderTop: backgroundStyle.borderTop } : {},
		...parentStyle.borderRight === void 0 && backgroundStyle.borderRight !== void 0 ? { borderRight: backgroundStyle.borderRight } : {},
		...parentStyle.borderBottom === void 0 && backgroundStyle.borderBottom !== void 0 ? { borderBottom: backgroundStyle.borderBottom } : {},
		...parentStyle.borderLeft === void 0 && backgroundStyle.borderLeft !== void 0 ? { borderLeft: backgroundStyle.borderLeft } : {}
	};
	if (parent.imageUrl === void 0 && background.imageUrl !== void 0) {
		parent.imageUrl = background.imageUrl;
		if (background.imageResourceNodeId !== void 0) parent.imageResourceNodeId = background.imageResourceNodeId;
	} else if (copiesBackgroundImage && parent.imageResourceNodeId === void 0 && background.imageResourceNodeId !== void 0) parent.imageResourceNodeId = background.imageResourceNodeId;
}
function foldFullCoverBackgroundsIntoParent(node, kids) {
	const next = [];
	for (const child of kids) {
		if (isFoldableFullCoverBackground(node, child)) {
			mergeFullCoverBackgroundIntoParent(node, child);
			continue;
		}
		next.push(child);
	}
	return next;
}
function backgroundContainerPlan(parent, kids, backgroundIndex) {
	const background = kids[backgroundIndex];
	if (!isMaterializableBackgroundContainer(background)) return void 0;
	const contained = new Set(background.backgroundLayer.containedNodeIds);
	if (shouldFoldFullCoverBackground(parent, background)) return void 0;
	const wrappedNodes = [];
	const wrappedIndices = /* @__PURE__ */ new Set();
	for (let i = 0; i < backgroundIndex; i++) if (contained.has(kids[i].id)) {
		wrappedNodes.push(kids[i]);
		wrappedIndices.add(i);
	}
	if (wrappedNodes.length === 0) return void 0;
	const insertIndex = Math.min(...wrappedIndices);
	const spanIndices = /* @__PURE__ */ new Set();
	for (let i = insertIndex; i <= backgroundIndex; i++) {
		spanIndices.add(i);
		if (i !== backgroundIndex && !wrappedIndices.has(i)) return;
	}
	return {
		backgroundIndex,
		insertIndex,
		score: background.backgroundLayer.score,
		wrappedNodes,
		spanIndices
	};
}
function selectBackgroundContainerPlans(plans) {
	const selected = [];
	const used = /* @__PURE__ */ new Set();
	const byPriority = [...plans].sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		if (b.wrappedNodes.length !== a.wrappedNodes.length) return b.wrappedNodes.length - a.wrappedNodes.length;
		return a.spanIndices.size - b.spanIndices.size;
	});
	for (const plan of byPriority) {
		if ([...plan.spanIndices].some((index) => used.has(index))) continue;
		selected.push(plan);
		for (const index of plan.spanIndices) used.add(index);
	}
	return selected.sort((a, b) => b.backgroundIndex - a.backgroundIndex);
}
function applyBackgroundContainerPlan(kids, plan) {
	const background = kids[plan.backgroundIndex];
	background.type = "FRAME";
	background.children = plan.wrappedNodes;
	background.virtualContainer = {
		kind: "background-container",
		backgroundNodeId: background.id,
		wrappedNodeIds: plan.wrappedNodes.map((node) => node.id),
		reason: "background-layer"
	};
	const next = [];
	for (let i = 0; i < kids.length; i++) {
		if (i === plan.insertIndex) next.push(background);
		if (plan.spanIndices.has(i)) continue;
		next.push(kids[i]);
	}
	return next;
}
function materializeBackgroundContainers(node) {
	let kids = node.children;
	if (kids && kids.length > 0) {
		kids = foldFullCoverBackgroundsIntoParent(node, kids);
		const plans = selectBackgroundContainerPlans(kids.map((_, index) => backgroundContainerPlan(node, kids, index)).filter((plan) => !!plan));
		for (const plan of plans) kids = applyBackgroundContainerPlan(kids, plan);
		node.children = kids;
		node.children.forEach(materializeBackgroundContainers);
	}
}
/**
* Stage 3：基于 Stage 2 产物，把可信 background layer 物化为虚拟容器。
*
* Stage 3 仍保持 Figma 图层顺序语义：children[0] 是视觉最上层。
*/
function parseDesignStage3(raw) {
	const root = parseDesign(raw);
	materializeBackgroundContainers(root);
	fillFigmaOrderTreeMetadata(root);
	return root;
}
//#endregion
//#region src/pipeline/stage4-layer-order/index.ts
function normalizeLayerOrderForHtml(node) {
	if (!node.children) return;
	node.children.reverse();
	node.children.forEach(normalizeLayerOrderForHtml);
}
/**
* Stage 4：基于 Stage 3 产物，把同级 children 转成 HTML DOM 绘制顺序。
*
* Stage 3 约定 children[0] 是视觉最上层；Stage 4 后 children[0] 是最底层，
* 让后续 HTML 输出可以依赖 DOM 顺序表达同级层级，不再需要普通 z-index。
*/
function parseDesignStage4(raw) {
	const root = parseDesignStage3(raw);
	normalizeLayerOrderForHtml(root);
	fillHtmlOrderTreeMetadata$1(root);
	return root;
}
//#endregion
//#region src/pipeline/stage5-y-order/index.ts
function sortChildrenByYTopEdge(node) {
	if (!node.children) return;
	node.children.sort((a, b) => a.geometry.y - b.geometry.y);
	node.children.forEach(sortChildrenByYTopEdge);
}
/**
* Stage 5：基于 Stage 4，把同级 children 按 geometry.y 升序重排。
*
* children[0] = 视觉上最靠上的兄弟节点。同 y 时保留 stage4 顺序。
*/
function parseDesignStage5(raw) {
	const root = parseDesignStage4(raw);
	sortChildrenByYTopEdge(root);
	fillHtmlOrderTreeMetadata$1(root);
	return root;
}
//#endregion
//#region src/pipeline/stage6-row-order/index.ts
var DEFAULT_ROW_TOLERANCE = 4;
var STAGE6_ROW_OVERLAP_RATIO = .5;
function yOverlapRatio(a, b) {
	const aTop = a.geometry.y;
	const aBottom = aTop + a.geometry.height;
	const bTop = b.geometry.y;
	const bBottom = bTop + b.geometry.height;
	const overlap = Math.min(aBottom, bBottom) - Math.max(aTop, bTop);
	if (overlap <= 0) return 0;
	const minHeight = Math.min(a.geometry.height, b.geometry.height);
	if (minHeight <= 0) return 0;
	return overlap / minHeight;
}
function isStage6SameRow(a, b, tolerance) {
	return Math.abs(b.geometry.y - a.geometry.y) < tolerance && yOverlapRatio(a, b) > STAGE6_ROW_OVERLAP_RATIO;
}
function sortChildrenByXWithinRows(node, tolerance = DEFAULT_ROW_TOLERANCE) {
	if (!node.children) return;
	const kids = node.children;
	const out = [];
	let i = 0;
	while (i < kids.length) {
		let j = i + 1;
		while (j < kids.length && isStage6SameRow(kids[i], kids[j], tolerance)) j++;
		const row = kids.slice(i, j).sort((a, b) => a.geometry.x - b.geometry.x);
		out.push(...row);
		i = j;
	}
	node.children = out;
	out.forEach((c) => sortChildrenByXWithinRows(c, tolerance));
}
/**
* Stage 6：基于 Stage 5，在「同一行」（|Δy| < tolerance）内按 geometry.x 升序重排。
*
* tolerance 默认 4px，可传参调；UI 不暴露。跨行不混。
*/
function parseDesignStage6(raw, tolerance = DEFAULT_ROW_TOLERANCE) {
	const root = parseDesignStage5(raw);
	sortChildrenByXWithinRows(root, tolerance);
	fillHtmlOrderTreeMetadata$1(root);
	return root;
}
//#endregion
//#region src/pipeline/stage7-structural-containers/index.ts
var ROW_OVERLAP_RATIO = .5;
var X_OVERLAP_TOLERANCE = .3;
var X_CENTER_TOLERANCE = 4;
function xOverlapRatio$1(a, b) {
	const aLeft = a.geometry.x;
	const aRight = aLeft + a.geometry.width;
	const bLeft = b.geometry.x;
	const bRight = bLeft + b.geometry.width;
	const overlap = Math.min(aRight, bRight) - Math.max(aLeft, bLeft);
	if (overlap <= 0) return 0;
	const minWidth = Math.min(a.geometry.width, b.geometry.width);
	if (minWidth <= 0) return 0;
	return overlap / minWidth;
}
function xCenter(node) {
	return node.geometry.x + node.geometry.width / 2;
}
function sortByXThenY(nodes) {
	return [...nodes].sort((a, b) => a.geometry.x - b.geometry.x || a.geometry.y - b.geometry.y);
}
function sortByYThenX(nodes) {
	return [...nodes].sort((a, b) => a.geometry.y - b.geometry.y || a.geometry.x - b.geometry.x);
}
function clusterIntoRows(children) {
	if (children.length === 0) return [];
	const rows = [];
	let current = [children[0]];
	let currentTop = children[0].geometry.y;
	let currentBottom = children[0].geometry.y + children[0].geometry.height;
	for (let i = 1; i < children.length; i++) {
		const child = children[i];
		const top = child.geometry.y;
		const bottom = top + child.geometry.height;
		const overlap = Math.min(bottom, currentBottom) - Math.max(top, currentTop);
		const minH = Math.min(child.geometry.height, currentBottom - currentTop);
		if (!(minH > 0 && overlap / minH > ROW_OVERLAP_RATIO)) {
			rows.push(current);
			current = [child];
			currentTop = top;
			currentBottom = bottom;
			continue;
		}
		if (current.some((member) => xOverlapRatio$1(child, member) > X_OVERLAP_TOLERANCE)) {
			rows.push(current);
			current = [child];
			currentTop = top;
			currentBottom = bottom;
			continue;
		}
		current.push(child);
		currentTop = Math.min(currentTop, top);
		currentBottom = Math.max(currentBottom, bottom);
	}
	rows.push(current);
	return rows;
}
function nodesBbox(nodes) {
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const n of nodes) {
		const g = n.geometry;
		if (g.x < minX) minX = g.x;
		if (g.y < minY) minY = g.y;
		if (g.x + g.width > maxX) maxX = g.x + g.width;
		if (g.y + g.height > maxY) maxY = g.y + g.height;
	}
	return {
		x: minX,
		y: minY,
		width: maxX - minX,
		height: maxY - minY
	};
}
function rowsFormGrid(rowA, rowB) {
	if (rowA.length !== rowB.length) return false;
	if (rowA.length < 2) return false;
	const sortedA = [...rowA].sort((a, b) => xCenter(a) - xCenter(b));
	const sortedB = [...rowB].sort((a, b) => xCenter(a) - xCenter(b));
	for (let i = 0; i < sortedA.length; i++) if (Math.abs(xCenter(sortedA[i]) - xCenter(sortedB[i])) > X_CENTER_TOLERANCE) return false;
	return true;
}
function groupRowsIntoBlocks(rows) {
	const blocks = [];
	let i = 0;
	while (i < rows.length) {
		let j = i;
		while (j + 1 < rows.length && rowsFormGrid(rows[i], rows[j + 1])) j++;
		if (j > i) {
			const sortedRows = rows.slice(i, j + 1).map((r) => [...r].sort((a, b) => xCenter(a) - xCenter(b)));
			const K = sortedRows[0].length;
			const columns = [];
			for (let col = 0; col < K; col++) columns.push(sortedRows.map((r) => r[col]));
			blocks.push({
				type: "grid",
				columns
			});
			i = j + 1;
		} else {
			blocks.push({
				type: "row",
				row: rows[i]
			});
			i++;
		}
	}
	return blocks;
}
function makeContainer(parent, members, kind, idSuffix, displayName, reason) {
	const orderedMembers = kind === "row-container" ? sortByXThenY(members) : sortByYThenX(members);
	const bbox = nodesBbox(orderedMembers);
	const id = `${parent.id}__${idSuffix}`;
	const sourcePaintOrder = maxSourcePaintOrder(orderedMembers);
	const container = {
		id,
		name: displayName,
		type: "FRAME",
		geometry: bbox,
		depth: parent.depth + 1,
		zIndex: 0,
		renderOrder: 0,
		parentId: parent.id,
		children: orderedMembers,
		...sourcePaintOrder !== void 0 ? { sourcePaintOrder } : {},
		virtualContainer: {
			kind,
			wrappedNodeIds: orderedMembers.map((c) => c.id),
			reason
		}
	};
	orderedMembers.forEach((c) => {
		c.parentId = id;
	});
	return container;
}
function maxSourcePaintOrder(nodes) {
	let max;
	for (const node of nodes) {
		if (typeof node.sourcePaintOrder !== "number") continue;
		max = max === void 0 ? node.sourcePaintOrder : Math.max(max, node.sourcePaintOrder);
	}
	return max;
}
function materializeStructuralContainers(node) {
	node.children?.forEach(materializeStructuralContainers);
	const kids = node.children;
	if (!kids || kids.length < 2) return;
	const existing = node.virtualContainer?.kind;
	if (existing === "row-container" || existing === "column-container") return;
	const rows = clusterIntoRows(kids);
	if (!rows.some((r) => r.length >= 2)) return;
	if (rows.length === 1 && rows[0].length === kids.length) {
		node.children = sortByXThenY(rows[0]);
		return;
	}
	const blocks = groupRowsIntoBlocks(rows);
	let rowSeq = 1;
	const newKids = [];
	for (let blockIdx = 0; blockIdx < blocks.length; blockIdx++) {
		const block = blocks[blockIdx];
		if (block.type === "grid") {
			const rowContainer = makeContainer(node, block.columns.map((colMembers, colIdx) => makeContainer(node, colMembers, "column-container", `block${blockIdx}_col${colIdx}`, `col ${colIdx + 1}`, "vertical-column")), "row-container", `block${blockIdx}_row`, `row ${rowSeq++}`, "grid-row");
			newKids.push(rowContainer);
		} else {
			const row = block.row;
			if (row.length >= 2) newKids.push(makeContainer(node, row, "row-container", `block${blockIdx}_row`, `row ${rowSeq++}`, "horizontal-row"));
			else newKids.push(...row);
		}
	}
	node.children = newKids;
}
/**
* Stage 7：基于 Stage 6，识别同一视觉行 / 网格列对齐的兄弟，物化为
* 'row-container' / 'column-container' 虚拟容器。
*
* 物化后父节点的 children 是结构化的容器（行 / 行内嵌列），为后续 stage 9
* direction 推断免去几何判断。
*/
function parseDesignStage7(raw) {
	const root = parseDesignStage6(raw);
	materializeStructuralContainers(root);
	fillHtmlOrderTreeMetadata$1(root);
	return root;
}
//#endregion
//#region src/pipeline/stage9-direction/index.ts
/** Stage 9 几何 fallback:children x-span 显著大于 y-span → row;否则 column(默认竖排)。
*  +2 阈值容忍亚像素抖动。 */
function inferDirectionFromGeometry(kids) {
	let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
	for (const k of kids) {
		const g = k.geometry;
		if (g.x < minX) minX = g.x;
		if (g.x + g.width > maxX) maxX = g.x + g.width;
		if (g.y < minY) minY = g.y;
		if (g.y + g.height > maxY) maxY = g.y + g.height;
	}
	if (maxX - minX > maxY - minY + 2) return "row";
	return "column";
}
function inferDirectionFromAxisSeparation(kids) {
	if (kids.length < 2) return void 0;
	const xSeparated = intervalsSeparatedOnAxis(kids, "x");
	const ySeparated = intervalsSeparatedOnAxis(kids, "y");
	if (ySeparated && !xSeparated) return "column";
	if (xSeparated && !ySeparated) return "row";
}
function intervalsSeparatedOnAxis(kids, axis, tolerance = .5) {
	const ordered = [...kids].sort((a, b) => axisStart(a, axis) - axisStart(b, axis));
	for (let i = 1; i < ordered.length; i++) if (axisStart(ordered[i], axis) < axisEnd(ordered[i - 1], axis) - tolerance) return false;
	return true;
}
function axisStart(node, axis) {
	return axis === "x" ? node.geometry.x : node.geometry.y;
}
function axisEnd(node, axis) {
	return axis === "x" ? node.geometry.x + node.geometry.width : node.geometry.y + node.geometry.height;
}
/** Stage 9 主推断函数。优先级:virtual container kind > hint > 几何 fallback。
*  hint 与几何不一致时记录 hintConflict 但仍信 hint。 */
function inferDirection(node, kids) {
	const kind = node.virtualContainer?.kind;
	if (kind === "row-container") return {
		mode: "flex",
		direction: "row"
	};
	if (kind === "column-container") return {
		mode: "flex",
		direction: "column"
	};
	const axisDirection = inferDirectionFromAxisSeparation(kids);
	const inferredFromGeom = axisDirection ?? inferDirectionFromGeometry(kids);
	const hintMode = node.hints?.autoLayout?.mode;
	if (hintMode === "HORIZONTAL" || hintMode === "VERTICAL") {
		const hintDirection = hintMode === "HORIZONTAL" ? "row" : "column";
		const layout = {
			mode: "flex",
			direction: hintDirection
		};
		if (hintDirection !== inferredFromGeom) layout.hintConflicts = [{
			field: "mode",
			hint: hintMode,
			inferred: inferredFromGeom === "row" ? "HORIZONTAL" : "VERTICAL",
			reason: axisDirection ? `geometry suggests ${axisDirection}: 1D axis separation` : `geometry suggests ${inferredFromGeom}: x-span vs y-span`
		}];
		return layout;
	}
	return {
		mode: "flex",
		direction: inferredFromGeom
	};
}
var CONTAINER_TYPES_FOR_DIRECTION = new Set([
	"FRAME",
	"GROUP",
	"INSTANCE",
	"COMPONENT"
]);
function annotateDirection(node) {
	node.children?.forEach(annotateDirection);
	const kids = node.children;
	if (!kids || kids.length < 2) return;
	if (!CONTAINER_TYPES_FOR_DIRECTION.has(node.type)) return;
	const layout = inferDirection(node, kids);
	if (layout) node.layout = layout;
}
/**
* Stage 9:基于 Stage 7,给每个 ≥2 children 的 container 节点打 layout.direction。
*
* 优先级:virtual container kind > hint > 几何 fallback。
* 不修改树结构,只附加 layout 元数据。视觉零变化。
*/
function parseDesignStage9(raw) {
	const root = parseDesignStage7(raw);
	annotateDirection(root);
	annotateClipDecisions(root);
	return root;
}
//#endregion
//#region src/pipeline/stage10-spacing/index.ts
/** 数学中位数：排序后，奇数取中间，偶数取中间两值的平均。 */
function median(values) {
	if (values.length === 0) throw new Error("median of empty array");
	const sorted = [...values].sort((a, b) => a - b);
	const n = sorted.length;
	const mid = Math.floor(n / 2);
	return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
var LAYOUT_FLOAT_EPSILON = 1e-6;
function normalizeLayoutMetric(n, opts = {}) {
	const normalized = Math.abs(n) <= LAYOUT_FLOAT_EPSILON ? 0 : n;
	return opts.clampNegative ? Math.max(0, normalized) : normalized;
}
/** padding 4 边必须全 finite（防御 round-trip 脏数据） */
function isFinitePadding(p) {
	return p !== void 0 && Number.isFinite(p.top) && Number.isFinite(p.right) && Number.isFinite(p.bottom) && Number.isFinite(p.left);
}
/** 把 padding 4 边规范化：负值截 0，`-0` 归 0（同 geom 规范） */
function sanitizePadding(p) {
	const norm = (n) => normalizeLayoutMetric(n, { clampNegative: true });
	return {
		top: norm(p.top),
		right: norm(p.right),
		bottom: norm(p.bottom),
		left: norm(p.left)
	};
}
/** Stage 10 几何 padding 计算：父框 4 边到 flowing children 最近边的距离。
*  非 finite 的 raw distance 直接返回 null；clamp 负值到 0。 */
function computeGeometricPadding(parent, flowing) {
	if (flowing.length < 1) return null;
	const px = parent.geometry.x;
	const py = parent.geometry.y;
	const pw = parent.geometry.width;
	const ph = parent.geometry.height;
	let minTop = Infinity, minLeft = Infinity, minRight = Infinity, minBottom = Infinity;
	for (const c of flowing) {
		const cx = c.geometry.x, cy = c.geometry.y;
		const cw = c.geometry.width, ch = c.geometry.height;
		const top = cy - py;
		const left = cx - px;
		const right = px + pw - (cx + cw);
		const bottom = py + ph - (cy + ch);
		if (top < minTop) minTop = top;
		if (left < minLeft) minLeft = left;
		if (right < minRight) minRight = right;
		if (bottom < minBottom) minBottom = bottom;
	}
	if (![
		minTop,
		minLeft,
		minRight,
		minBottom
	].every(Number.isFinite)) return null;
	const norm = (n) => normalizeLayoutMetric(n, { clampNegative: true });
	return {
		top: norm(minTop),
		right: norm(minRight),
		bottom: norm(minBottom),
		left: norm(minLeft)
	};
}
function flowingChildren(kids) {
	return kids.filter((c) => !isOutOfFlow(c));
}
function computeGeometricGap(flowing, direction) {
	if (flowing.length < 2) return { kind: "unavailable" };
	const sorted = [...flowing].sort((a, b) => {
		if (direction === "row") return a.geometry.x - b.geometry.x || a.geometry.y - b.geometry.y || a.id.localeCompare(b.id);
		return a.geometry.y - b.geometry.y || a.geometry.x - b.geometry.x || a.id.localeCompare(b.id);
	});
	const gaps = [];
	for (let i = 1; i < sorted.length; i++) {
		const prev = sorted[i - 1].geometry;
		const cur = sorted[i].geometry;
		const g = direction === "row" ? cur.x - (prev.x + prev.width) : cur.y - (prev.y + prev.height);
		gaps.push(normalizeLayoutMetric(g));
	}
	if (!gaps.every(Number.isFinite)) return { kind: "unavailable" };
	const min = Math.min(...gaps);
	if (Math.max(...gaps) - min <= 2) return {
		kind: "uniform",
		value: median(gaps),
		gaps
	};
	return {
		kind: "non-uniform",
		gaps
	};
}
function isComputedGeomPadding(p) {
	return p !== null && Number.isFinite(p.top) && Number.isFinite(p.right) && Number.isFinite(p.bottom) && Number.isFinite(p.left);
}
function addConflict(node, conflict) {
	if (node.layout?.mode !== "flex") return;
	node.layout.hintConflicts = (node.layout.hintConflicts ?? []).concat(conflict);
}
function applyPadding(node, geom) {
	if (node.layout?.mode !== "flex") return;
	const rawHint = node.hints?.autoLayout?.padding;
	const hint = isFinitePadding(rawHint) ? sanitizePadding(rawHint) : null;
	let writeValue = null;
	if (hint) writeValue = hint;
	else if (geom) writeValue = geom;
	if (writeValue) {
		if (writeValue.top > 0 || writeValue.right > 0 || writeValue.bottom > 0 || writeValue.left > 0) node.layout.padding = { ...writeValue };
	}
	if (hint && isComputedGeomPadding(geom)) {
		const triggered = [];
		if (Math.abs(hint.top - geom.top) > 2) triggered.push("top");
		if (Math.abs(hint.right - geom.right) > 2) triggered.push("right");
		if (Math.abs(hint.bottom - geom.bottom) > 2) triggered.push("bottom");
		if (Math.abs(hint.left - geom.left) > 2) triggered.push("left");
		if (triggered.length > 0) addConflict(node, {
			field: "padding",
			hint: { ...hint },
			inferred: { ...geom },
			reason: `padding differs on ${triggered.join(", ")} beyond 2px`
		});
	}
}
function applyGap(node, geom) {
	if (node.layout?.mode !== "flex") return;
	const rawHintGap = node.hints?.autoLayout?.gap;
	const hintGap = rawHintGap !== void 0 && Number.isFinite(rawHintGap) ? normalizeLayoutMetric(rawHintGap) : void 0;
	const geomValue = geom.kind === "uniform" ? normalizeLayoutMetric(geom.value) : void 0;
	if (hintGap !== void 0) {
		if (hintGap > 0) node.layout.gap = hintGap;
	} else if (geomValue !== void 0 && geomValue > 0) node.layout.gap = geomValue;
	if (hintGap === void 0) return;
	switch (geom.kind) {
		case "unavailable": break;
		case "uniform":
			if (geomValue === void 0) break;
			if (Math.abs(hintGap - geomValue) > 2) addConflict(node, {
				field: "gap",
				hint: hintGap,
				inferred: {
					kind: "uniform",
					value: geomValue,
					gaps: geom.gaps
				},
				reason: `geometry uniform gap ${geomValue}, hint claims ${hintGap}`
			});
			break;
		case "non-uniform":
			addConflict(node, {
				field: "gap",
				hint: hintGap,
				inferred: {
					kind: "non-uniform",
					gaps: geom.gaps
				},
				reason: `geometry has non-uniform gaps; hint claims single uniform value ${hintGap}`
			});
			break;
	}
}
function annotatePaddingGap(node) {
	node.children?.forEach(annotatePaddingGap);
	if (node.layout?.mode !== "flex") return;
	const dir = node.layout.direction;
	if (dir !== "row" && dir !== "column") return;
	const kids = node.children;
	if (!kids || kids.length === 0) return;
	const flowing = flowingChildren(kids);
	applyPadding(node, flowing.length >= 1 ? computeGeometricPadding(node, flowing) : null);
	applyGap(node, computeGeometricGap(flowing, dir));
}
/**
* Stage 10：基于 Stage 9，给已打 `layout.mode === 'flex'` 的容器填 padding 和 gap。
*
* 优先级：hint > 几何 fallback。Hint 经过 finite + sanitize 防御。
* Flowing children 复用 isOutOfFlow 单一真值源；GeometricGap 三态；writes 严格 > 0；
* conflicts 在 hint 存在时记录（append 到现有 hintConflicts，不覆盖 stage 9 的 mode conflict）。
* 视觉零变化。
*/
function parseDesignStage10(raw) {
	const root = parseDesignStage9(raw);
	annotatePaddingGap(root);
	return root;
}
//#endregion
//#region src/pipeline/stage11-align/index.ts
function hasFiniteGeometry(node) {
	const g = node.geometry;
	return Number.isFinite(g.x) && Number.isFinite(g.y) && Number.isFinite(g.width) && Number.isFinite(g.height);
}
function mapFigmaAlign(figma) {
	switch (figma) {
		case "MIN": return "flex-start";
		case "CENTER": return "center";
		case "MAX": return "flex-end";
		default: return;
	}
}
function inferAlignFromGeometry(flowing, direction, tol = 2) {
	if (flowing.length < 2) return void 0;
	const isCol = direction === "column";
	const starts = flowing.map((c) => isCol ? c.geometry.x : c.geometry.y);
	const ends = flowing.map((c) => isCol ? c.geometry.x + c.geometry.width : c.geometry.y + c.geometry.height);
	const centers = starts.map((s, i) => s + (ends[i] - s) / 2);
	const span = (a) => Math.max(...a) - Math.min(...a);
	if (span(starts) <= tol) return "flex-start";
	if (span(centers) <= tol) return "center";
	if (span(ends) <= tol) return "flex-end";
}
function applyAlign(node, inferred, fromHint, flowing) {
	if (node.layout?.mode !== "flex") return;
	if (inferred !== "flex-start") node.layout.align = inferred;
	if (fromHint && node.layout.direction) {
		const geom = inferAlignFromGeometry(flowing, node.layout.direction);
		if (geom !== void 0 && geom !== inferred) {
			const conflict = {
				field: "align",
				hint: inferred,
				inferred: geom,
				reason: `hint says ${inferred}, geometry suggests ${geom}`
			};
			node.layout.hintConflicts = [...node.layout.hintConflicts ?? [], conflict];
		}
	}
}
function inferAlignForContainer(node) {
	if (node.layout?.mode !== "flex") return;
	if (!node.layout.direction) return;
	if (!hasFiniteGeometry(node)) return;
	const flowing = flowingChildren(node.children ?? []);
	if (flowing.length < 2) return;
	if (flowing.some((c) => !hasFiniteGeometry(c))) return;
	const hintAlign = mapFigmaAlign(node.hints?.autoLayout?.counterAlign);
	if (hintAlign !== void 0) {
		applyAlign(node, hintAlign, true, flowing);
		return;
	}
	const geomAlign = inferAlignFromGeometry(flowing, node.layout.direction);
	if (geomAlign !== void 0) applyAlign(node, geomAlign, false, flowing);
}
function inferAlignAcrossTree(node) {
	node.children?.forEach(inferAlignAcrossTree);
	inferAlignForContainer(node);
}
/**
* Stage 11: 推断 mode='flex' container 的 layout.align（cross-axis 对齐）。
* Hint 优先（mapFigmaAlign of MIN/CENTER/MAX）+ 几何 fallback (starts/centers/ends span ≤ 2 px)。
* 优先级 flex-start > center > flex-end。'flex-start' 不写出（CSS 默认）。
*
* 注:执行序为 stage 10 → 11 → 12 (= 番号序);stage 12 在本步之后把不可行 flex
* 降级为 absolute,自然丢弃这一步写的 align 字段。
*/
function parseDesignStage11(raw) {
	const root = parseDesignStage10(raw);
	inferAlignAcrossTree(root);
	return root;
}
//#endregion
//#region src/pipeline/stage12-flex-feasibility/index.ts
var DEFAULT_SUBSTANTIAL_OVERLAP_THRESHOLD = .05;
var ROOT_EDGE_GRAZE_OVERLAP_THRESHOLD = .2;
function hasBackgroundLayerSignal(parent, children = parent.children ?? []) {
	if (parent.style?.backgroundImage) return true;
	return children.some((child) => child.imageRole === "background" || child.backgroundLayer !== void 0 || child.virtualContainer?.kind === "background-container" || (child.children ?? []).some((grandChild) => grandChild.imageRole === "background" || grandChild.backgroundLayer !== void 0));
}
function isRootLongContentOverflow(parent, flowing, children = parent.children ?? []) {
	if (flowing.length === 0) return false;
	if (!hasBackgroundLayerSignal(parent, children)) return false;
	const bbox = nodesBbox$1(flowing);
	const parentRight = parent.geometry.x + parent.geometry.width;
	const parentBottom = parent.geometry.y + parent.geometry.height;
	const bboxRight = bbox.x + bbox.width;
	const bboxBottom = bbox.y + bbox.height;
	const leftOverflow = Math.max(0, parent.geometry.x - bbox.x);
	const topOverflow = Math.max(0, parent.geometry.y - bbox.y);
	const rightOverflow = Math.max(0, bboxRight - parentRight);
	const bottomOverflow = Math.max(0, bboxBottom - parentBottom);
	const edgeTolerance = 8;
	const longContentOverflow = 50;
	return bottomOverflow > longContentOverflow && bbox.height > parent.geometry.height + longContentOverflow && leftOverflow <= edgeTolerance && rightOverflow <= edgeTolerance && topOverflow <= edgeTolerance;
}
/** T1: 任一对 flowing 子节点 intersectionArea / min(area) > threshold */
function flowSubstantialOverlap(flowing, threshold = DEFAULT_SUBSTANTIAL_OVERLAP_THRESHOLD) {
	for (let i = 0; i < flowing.length; i++) for (let j = i + 1; j < flowing.length; j++) {
		const ai = boundingBoxArea(flowing[i].geometry);
		const aj = boundingBoxArea(flowing[j].geometry);
		const minA = Math.min(ai, aj);
		if (minA <= 0) continue;
		if (intersectionArea(flowing[i].geometry, flowing[j].geometry) / minA > threshold) return true;
	}
	return false;
}
/** T2: flowing bbox 越界 container（比例 > 1.10 或任一边 overflow > 8 px） */
function flowExceedsContainer(parent, flowing, spanRatioThreshold = 1.1, edgeOverflowThreshold = 8, options = {}) {
	if (flowing.length === 0) return false;
	if (options.isRoot && isRootLongContentOverflow(parent, flowing, options.children ?? parent.children ?? [])) return false;
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const c of flowing) {
		const g = c.geometry;
		if (g.x < minX) minX = g.x;
		if (g.y < minY) minY = g.y;
		if (g.x + g.width > maxX) maxX = g.x + g.width;
		if (g.y + g.height > maxY) maxY = g.y + g.height;
	}
	const spanW = maxX - minX;
	const spanH = maxY - minY;
	const rootW = parent.geometry.width;
	const rootH = parent.geometry.height;
	if (rootW * rootH > 0) {
		if (spanW * spanH / (rootW * rootH) > spanRatioThreshold) return true;
	}
	const leftOverflow = parent.geometry.x - minX;
	const topOverflow = parent.geometry.y - minY;
	const rightOverflow = maxX - (parent.geometry.x + rootW);
	const bottomOverflow = maxY - (parent.geometry.y + rootH);
	return Math.max(leftOverflow, topOverflow, rightOverflow, bottomOverflow) > edgeOverflowThreshold;
}
/** T3: 复用 stage10 computeGeometricGap,kind=non-uniform 且 max-min > threshold */
function flowGapsIrregular(flowing, direction, maxMinDiffThreshold = 16) {
	if (flowing.length < 2) return false;
	const geom = computeGeometricGap(flowing, direction);
	if (geom.kind !== "non-uniform") return false;
	const min = Math.min(...geom.gaps);
	return Math.max(...geom.gaps) - min > maxMinDiffThreshold;
}
/** T4: cross-axis 单值 align 救不了 — flowing children 的 starts/centers/ends 三套
*  span 全 > tol。1 行复用 stage 11 的 inferAlignFromGeometry 几何判定。
*  flow.length < 2 时返回 false(防御:T0 应已捕获,这里不重复触发)。 */
function flowNotAlignable(flow, direction, tol = 2) {
	if (flow.length < 2) return false;
	return inferAlignFromGeometry(flow, direction, tol) === void 0;
}
/** T5: layout.hintConflicts 中存在 hint 跟 geom 严重分歧的 gap/padding conflict
*  → 说明 stage 10 信的 hint 几何上不成立,flex 渲染会错位,降级 absolute。
*  零额外几何计算,完全读 stage 10 已记的 audit trail。 */
function flowHintMismatch(layout, gapTol = 50, paddingTol = 20) {
	const conflicts = layout?.hintConflicts ?? [];
	for (const c of conflicts) if (c.field === "gap") {
		const hintNum = typeof c.hint === "number" ? c.hint : null;
		const inf = c.inferred;
		const infValue = typeof inf?.value === "number" ? inf.value : null;
		if (hintNum !== null && infValue !== null && Math.abs(hintNum - infValue) > gapTol) return true;
	} else if (c.field === "padding") {
		const hintObj = c.hint;
		const infObj = c.inferred;
		if (hintObj && infObj) {
			if (Math.max(...[
				"top",
				"right",
				"bottom",
				"left"
			].map((s) => Math.abs((hintObj[s] ?? 0) - (infObj[s] ?? 0)))) > paddingTol) return true;
		}
	}
	return false;
}
/** T6: layout.gap 没写(stage 10 在几何 non-uniform 时不写 gap)但 children
*  之间确实存在非 zero 几何 gap → flex 渲染会贴左堆叠丢间距,降级 absolute。
*  跟 T1-T5 不同,T6 需要传 node 因为要从 children 几何重算 gap。 */
function flowMissingNonUniformGap(node, direction, minGapPx = 5) {
	if (node.layout?.mode !== "flex" || node.layout.gap !== void 0) return false;
	const flow = flowingChildren(node.children ?? []).filter(hasFiniteGeometry);
	if (flow.length < 2) return false;
	const isRow = direction === "row";
	const sorted = [...flow].sort((a, b) => (isRow ? a.geometry.x : a.geometry.y) - (isRow ? b.geometry.x : b.geometry.y));
	for (let i = 1; i < sorted.length; i++) {
		const prev = sorted[i - 1].geometry;
		const cur = sorted[i].geometry;
		const prevEnd = isRow ? prev.x + prev.width : prev.y + prev.height;
		if ((isRow ? cur.x : cur.y) - prevEnd > minGapPx) return true;
	}
	return false;
}
/** T7: mode=flex container 的 children DOM 顺序跟 main-axis 排序后顺序不一致
*  → CSS flex 按 DOM order 渲染 → children 位置跟 Figma absolute 不符,降级 absolute。
*  跟 T1-T6 不同,T7 比较的是 children 的相对顺序而不是数值阈值。 */
function flowDomOrderMismatch(node, direction) {
	if (node.layout?.mode !== "flex") return false;
	const flow = flowingChildren(node.children ?? []).filter(hasFiniteGeometry);
	if (flow.length < 2) return false;
	const isRow = direction === "row";
	const sorted = [...flow].sort((a, b) => (isRow ? a.geometry.x : a.geometry.y) - (isRow ? b.geometry.x : b.geometry.y));
	for (let i = 0; i < flow.length; i++) if (sorted[i] !== flow[i]) return true;
	return false;
}
function downgradeNonFlexableContainersImpl(node, isRoot = false) {
	node.children?.forEach((child) => downgradeNonFlexableContainersImpl(child, false));
	if (node.layout?.mode !== "flex") return;
	const direction = node.layout.direction;
	if (direction !== "row" && direction !== "column") return;
	const flow = flowingChildren(node.children ?? []);
	if (!hasFiniteGeometry(node)) return;
	if (flow.some((c) => !hasFiniteGeometry(c))) return;
	const triggers = [];
	const overlapThreshold = isRoot ? ROOT_EDGE_GRAZE_OVERLAP_THRESHOLD : DEFAULT_SUBSTANTIAL_OVERLAP_THRESHOLD;
	if (flow.length < 2) triggers.push(`T0 (flowing=${flow.length})`);
	if (triggers.length === 0 && flowSubstantialOverlap(flow, overlapThreshold)) triggers.push("T1 (substantial overlap)");
	if (triggers.length === 0 && flowExceedsContainer(node, flow, 1.1, 8, {
		isRoot,
		children: node.children ?? []
	})) triggers.push("T2 (exceeds container)");
	if (triggers.length === 0 && flowGapsIrregular(flow, direction)) triggers.push("T3 (irregular gap)");
	if (triggers.length === 0 && flowNotAlignable(flow, direction)) triggers.push("T4 (cross-axis non-alignable)");
	if (triggers.length === 0 && flowHintMismatch(node.layout)) triggers.push("T5 (hint-geom divergence)");
	if (triggers.length === 0 && flowMissingNonUniformGap(node, direction)) triggers.push("T6 (missing gap on non-uniform geometry)");
	if (triggers.length === 0 && flowDomOrderMismatch(node, direction)) triggers.push("T7 (DOM order mismatch)");
	if (triggers.length === 0) return;
	const prevConflicts = node.layout.hintConflicts ?? [];
	const newConflict = {
		field: "mode",
		hint: "flex",
		inferred: "absolute",
		reason: triggers.join(", ")
	};
	node.layout = {
		mode: "absolute",
		hintConflicts: [...prevConflicts, newConflict]
	};
}
function downgradeNonFlexableContainers(node) {
	downgradeNonFlexableContainersImpl(node, true);
}
/**
* Stage 12: 给 stage 11 后仍 mode='flex' 的 container 做 flex 可行性判定。
* 命中 T0-T7 任一触发器即降级 mode='absolute',layout 字面量重建为
* { mode: 'absolute', hintConflicts },自然丢弃 stage 11 写的 align 和所有 flex-only 字段。
* post-order 递归,几何优先(predicate 不参考 hint)。
*
* 注:不需要在末尾调 fillHtmlOrderTreeMetadata(stage 3-7 都需要),因为 stage 12
* 仅 mutate node.layout 字段,不重排树结构、不改 depth/zIndex/renderOrder。
*/
function parseDesignStage12(raw) {
	const root = parseDesignStage11(raw);
	downgradeNonFlexableContainers(root);
	return root;
}
//#endregion
//#region src/pipeline/stage13-semantics/index.ts
function textContent(node) {
	const out = [];
	const walk = (n) => {
		const text = n.characters?.trim().replace(/\s+/g, " ");
		if (text) out.push(text);
		n.children?.forEach(walk);
	};
	walk(node);
	return out;
}
function semanticLabel(node) {
	return textContent(node).filter((text) => text !== "08:08")[0];
}
function compactText(node) {
	return node.characters?.trim().replace(/\s+/g, " ");
}
function fontSizePx(node) {
	const raw = node.style?.fontSize;
	if (!raw) return 0;
	const parsed = Number.parseFloat(String(raw));
	return Number.isFinite(parsed) ? parsed : 0;
}
function geometryCoversRoot(node, root) {
	const g = node.geometry;
	const r = root.geometry;
	const widthRatio = g.width / Math.max(1, r.width);
	const heightRatio = g.height / Math.max(1, r.height);
	return widthRatio >= .95 && heightRatio >= .95 && g.x <= r.x + 5 && g.y <= r.y + 5;
}
function setSemantic(node, semantic) {
	if (node.semantic) return;
	node.semantic = semantic;
}
function isTitlebarName(name) {
	return /titlebar|floatingtitlebar|标题栏|global-nav|导航/i.test(name);
}
function isNonTitlebarControlName(name) {
	return /search|segmented|input/i.test(name);
}
function isBottomNavName(name) {
	return /aibottombar|floatingtab|bottom.?nav|tabbar/i.test(name);
}
function rootHasBottomNav(root) {
	return (root.children ?? []).some((child) => isBottomNavName(child.name));
}
function isDockCandidate(node, root) {
	if (!rootHasBottomNav(root)) return false;
	const g = node.geometry;
	const r = root.geometry;
	if (r.width > 500) return false;
	const nearDockBand = g.y >= r.y + r.height - 120 && g.y <= r.y + r.height - 35;
	const wideEnough = g.width >= r.width * .65;
	const dockHeight = g.height >= 40 && g.height <= 80;
	const hasNoText = textContent(node).length === 0;
	return nearDockBand && wideEnough && dockHeight && hasNoText;
}
function isFooterCandidate(node, root) {
	const g = node.geometry;
	const r = root.geometry;
	if (r.width < 1e3 || r.height < 1e3) return false;
	const nearBottom = g.y >= r.y + r.height * .7;
	const wideEnough = g.width >= r.width * .8;
	const text = textContent(node).join(" ");
	return nearBottom && wideEnough && /关于openEuler|友情链接|社区章程|贡献看板/.test(text);
}
function titlebarCandidate(node, root) {
	if (isNonTitlebarControlName(node.name)) return false;
	const g = node.geometry;
	const r = root.geometry;
	const topBand = g.y <= r.y + 60;
	const expectedHeight = g.height >= 40 && g.height <= 130;
	const wideEnough = g.width >= r.width * .55;
	if (topBand && expectedHeight && isTitlebarName(node.name)) return true;
	if (topBand && expectedHeight && wideEnough && semanticLabel(node)) return true;
	return false;
}
function headingCandidate(node, root) {
	if (node.type !== "TEXT") return false;
	const label = compactText(node);
	if (!label || label === "08:08") return false;
	if (/^[\d\s.%+°-]+$/.test(label)) return false;
	const g = node.geometry;
	const r = root.geometry;
	const fs = fontSizePx(node);
	if (fs >= 24 && g.y <= r.y + Math.max(180, r.height * .25)) return true;
	if (r.width >= 700 && fs >= 16 && g.y <= r.y + 90 && g.x <= r.x + r.width * .25) return true;
	return false;
}
function annotateStage13Semantics(root) {
	const titlebarKeys = /* @__PURE__ */ new Set();
	const headingCandidates = [];
	const visit = (node, parent, insideTitlebar = false) => {
		if (parent === root) {
			if ((node.imageRole === "background" || /背景|background/i.test(node.name)) && geometryCoversRoot(node, root) && node.name !== "Rectangle") setSemantic(node, {
				role: "background",
				positioning: "absolute-allowed",
				reason: /bindsheet/i.test(node.name) ? "bottom sheet visual background" : node.name === "graph" && node.type === "FRAME" ? "launcher sheet visual background" : "full-bleed visual background"
			});
			if (isDockCandidate(node, root)) setSemantic(node, {
				role: "dock",
				positioning: "flow",
				reason: "launcher dock near bottom edge"
			});
			if (isBottomNavName(node.name)) setSemantic(node, {
				role: "bottom-nav",
				positioning: "fixed",
				reason: "bottom navigation region"
			});
			if (isFooterCandidate(node, root)) setSemantic(node, {
				role: "footer",
				positioning: "flow",
				reason: "site footer near page bottom"
			});
			if (titlebarCandidate(node, root)) {
				const texts = textContent(node).filter((text) => text !== "08:08");
				const label = texts.length <= 2 || root.geometry.width <= 700 && texts.length <= 4 ? texts[0] : void 0;
				const key = `${label ?? ""}:${Math.round(node.geometry.x)}:${Math.round(node.geometry.y)}:${Math.round(node.geometry.width)}:${Math.round(node.geometry.height)}`;
				if (!titlebarKeys.has(key)) {
					titlebarKeys.add(key);
					setSemantic(node, {
						role: "titlebar",
						positioning: "sticky",
						reason: "top app or page titlebar",
						...label ? { label } : {}
					});
				}
			}
		}
		const nextInsideTitlebar = insideTitlebar || node.semantic?.role === "titlebar";
		if (!nextInsideTitlebar && headingCandidate(node, root)) headingCandidates.push(node);
		node.children?.forEach((child) => visit(child, node, nextInsideTitlebar));
	};
	visit(root);
	const hasTitlebar = titlebarKeys.size > 0;
	const strongHeadings = headingCandidates.filter((node) => fontSizePx(node) >= 32);
	const [bestHeading] = (hasTitlebar && strongHeadings.length > 0 ? strongHeadings : hasTitlebar ? [] : headingCandidates).sort((a, b) => {
		const fontDiff = fontSizePx(b) - fontSizePx(a);
		if (Math.abs(fontDiff) > .1) return fontDiff;
		return a.geometry.y - b.geometry.y || a.geometry.x - b.geometry.x;
	});
	const label = bestHeading ? compactText(bestHeading) : void 0;
	if (bestHeading && label) setSemantic(bestHeading, {
		role: "heading",
		label,
		positioning: "flow",
		reason: "top-level page heading text"
	});
}
function parseDesignStage13(raw) {
	const root = parseDesignStage12(raw);
	annotateStage13Semantics(root);
	return root;
}
//#endregion
//#region src/pipeline/stage14-layout/overlayExtraction.ts
var AREA_RATIO_THRESHOLD = 4;
/**
* outer 严格完全包含 inner（每像素都在 outer.bbox 内）。
* 边缘对齐（inner 边贴 outer 边）算包含。
*/
function isContainedBy(inner, outer) {
	return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}
function sourcePaintOrder(node) {
	return typeof node.sourcePaintOrder === "number" ? node.sourcePaintOrder : void 0;
}
function isSourcePaintedAbove(a, b) {
	const aOrder = sourcePaintOrder(a);
	const bOrder = sourcePaintOrder(b);
	if (aOrder === void 0 || bOrder === void 0) return void 0;
	return aOrder > bOrder;
}
function isVirtualLayoutContainer$1(node) {
	const kind = node.virtualContainer?.kind;
	return kind === "row-container" || kind === "column-container";
}
function isHtmlOrderedAbove(a, b) {
	return a.renderOrder > b.renderOrder;
}
function isCoveredByHigherSourceSibling(inner, flow) {
	const innerOrder = sourcePaintOrder(inner);
	if (innerOrder === void 0) return false;
	return flow.some((sibling) => {
		if (sibling === inner) return false;
		if (isVirtualLayoutContainer$1(sibling)) return false;
		const siblingOrder = sourcePaintOrder(sibling);
		return siblingOrder !== void 0 && siblingOrder > innerOrder && isContainedBy(inner.geometry, sibling.geometry);
	});
}
/**
* 判定一对 (outer, inner)：抽哪个、用哪个 outOfFlow 值。
* - A2 通路（4× area）：inner 必须在原始绘制顺序里高于 outer，且没有更高兄弟完整盖住它；
*   通过后抽 inner，标 'stage14-overlay'。两条通路同时命中时 A2 优先。
* - A3 通路（outer leaf 但不满足 4×）：抽 outer，标 'stage14-overlay-leaf'。
* - 都不命中：返回 null。
*/
function classifyPair(outer, inner, flow) {
	if (!isContainedBy(inner.geometry, outer.geometry)) return null;
	const outerArea = boundingBoxArea(outer.geometry);
	const innerArea = boundingBoxArea(inner.geometry);
	if (innerArea <= 0) return null;
	if (outerArea >= AREA_RATIO_THRESHOLD * innerArea) {
		if (isSourcePaintedAbove(inner, outer) === false && !(isVirtualLayoutContainer$1(outer) && isHtmlOrderedAbove(inner, outer))) return null;
		if (isCoveredByHigherSourceSibling(inner, flow)) return null;
		return {
			node: inner,
			kind: "stage14-overlay"
		};
	}
	if ((outer.children ?? []).every((c) => c.type === "SUPPOSITIONAL")) return {
		node: outer,
		kind: "stage14-overlay-leaf"
	};
	return null;
}
/**
* stage14 Phase A T1 救援:扫所有 child 对,识别可作为 overlay 抽出的 child。
* 两条通路:
*   - A2 套娃 (outer 4× 大于 inner + inner 原始绘制顺序更高):抽 inner,标 'stage14-overlay'
*   - A3 leaf 装饰 (outer 是 leaf 节点):抽 outer,标 'stage14-overlay-leaf'
* 单层 extraction:一个 child 一旦被标为 out-of-flow 就不再参与后续 pair 判定。
* 同 inner 被多个 outer 包(A2)或同 outer 被多次匹配(A3),由 Map 去重保证只标一次。
*/
function extractOverlayChildren(flow) {
	const extracted = /* @__PURE__ */ new Map();
	for (const a of flow) {
		if (extracted.has(a)) continue;
		for (const b of flow) {
			if (a === b) continue;
			if (extracted.has(b)) continue;
			const decision = classifyPair(a, b, flow);
			if (decision && !extracted.has(decision.node)) extracted.set(decision.node, decision.kind);
		}
	}
	const extractedSet = new Set(extracted.keys());
	return {
		remaining: flow.filter((c) => !extractedSet.has(c)),
		extracted: Array.from(extracted.entries()).map(([node, kind]) => ({
			node,
			kind
		}))
	};
}
//#endregion
//#region src/pipeline/stage14-layout/inferContainer.ts
function inferPadding(parent, flow) {
	if (flow.length === 0) return {
		top: 0,
		right: 0,
		bottom: 0,
		left: 0
	};
	const px = parent.geometry.x;
	const py = parent.geometry.y;
	const pw = parent.geometry.width;
	const ph = parent.geometry.height;
	let minLeft = Infinity, minTop = Infinity, minRight = Infinity, minBottom = Infinity;
	for (const c of flow) {
		minLeft = Math.min(minLeft, c.geometry.x - px);
		minTop = Math.min(minTop, c.geometry.y - py);
		minRight = Math.min(minRight, px + pw - (c.geometry.x + c.geometry.width));
		minBottom = Math.min(minBottom, py + ph - (c.geometry.y + c.geometry.height));
	}
	return {
		top: Math.max(0, Math.floor(minTop)),
		right: Math.max(0, Math.floor(minRight)),
		bottom: Math.max(0, Math.floor(minBottom)),
		left: Math.max(0, Math.floor(minLeft))
	};
}
function nonZeroPaddingEntry(padding) {
	return padding.top === 0 && padding.right === 0 && padding.bottom === 0 && padding.left === 0 ? {} : { padding };
}
var UNIFORM_GAP_TOLERANCE = 1;
function inferGap(flow, direction) {
	if (flow.length < 2) return { kind: "unavailable" };
	const sorted = [...flow].sort((a, b) => direction === "row" ? a.geometry.x - b.geometry.x : a.geometry.y - b.geometry.y);
	const gaps = [];
	for (let i = 1; i < sorted.length; i++) {
		const prev = sorted[i - 1].geometry;
		const cur = sorted[i].geometry;
		const g = direction === "row" ? cur.x - (prev.x + prev.width) : cur.y - (prev.y + prev.height);
		gaps.push(Math.round(g));
	}
	const min = Math.min(...gaps);
	if (Math.max(...gaps) - min > UNIFORM_GAP_TOLERANCE) return {
		kind: "irregular",
		perChildResidual: true
	};
	return {
		kind: "uniform",
		value: Math.max(0, min)
	};
}
var OVERFLOW_SOFT_LIMIT = 50;
var ROOT_NEGATIVE_EDGE_GRAZE_MARGIN_LIMIT = -24;
function readTriggers(node) {
	return (node.layout?.hintConflicts ?? []).filter((c) => c.field === "mode").map((c) => String(c.reason ?? ""));
}
function hasTrigger(triggers, code) {
	return triggers.some((r) => r.includes(code));
}
function hintDirection(parent) {
	const mode = parent.hints?.autoLayout?.mode;
	if (mode === "HORIZONTAL") return "row";
	if (mode === "VERTICAL") return "column";
}
function detectOverlap(flow, threshold = DEFAULT_SUBSTANTIAL_OVERLAP_THRESHOLD) {
	for (let i = 0; i < flow.length; i++) for (let j = i + 1; j < flow.length; j++) {
		const minArea = Math.min(boundingBoxArea(flow[i].geometry), boundingBoxArea(flow[j].geometry));
		if (minArea <= 0) continue;
		if (intersectionArea(flow[i].geometry, flow[j].geometry) / minArea > threshold) return true;
	}
	return false;
}
function detectOverflowMax(parent, flow) {
	const px = parent.geometry.x;
	const py = parent.geometry.y;
	const pw = parent.geometry.width;
	const ph = parent.geometry.height;
	let max = 0;
	for (const c of flow) max = Math.max(max, px - c.geometry.x, py - c.geometry.y, c.geometry.x + c.geometry.width - (px + pw), c.geometry.y + c.geometry.height - (py + ph));
	return Math.max(0, max);
}
function pickDirection(parent, flow, isRoot) {
	if (isRoot) return "column";
	if (flow.length === 0) return void 0;
	const kind = parent.virtualContainer?.kind;
	if (kind === "row-container") return "row";
	if (kind === "column-container" || kind === "background-container") return "column";
	if (parent.layout?.mode === "flex" && parent.layout.direction) return parent.layout.direction;
	const hinted = hintDirection(parent);
	if (hinted) return hinted;
	if (flow.length === 1) return "column";
	const axisDirection = inferDirectionFromAxisSeparation(flow);
	if (axisDirection) return axisDirection;
	return inferDirectionFromGeometry(flow);
}
function inferContainerLayout(parent, flowInput, opts) {
	let flow = flowInput.filter((c) => !isOutOfFlow(c));
	const triggers = readTriggers(parent);
	const overlapThreshold = opts.isRoot ? ROOT_EDGE_GRAZE_OVERLAP_THRESHOLD : DEFAULT_SUBSTANTIAL_OVERLAP_THRESHOLD;
	if (detectOverlap(flow, overlapThreshold)) {
		const { remaining, extracted } = extractOverlayChildren(flow);
		if (extracted.length > 0 && !detectOverlap(remaining, overlapThreshold)) {
			extracted.forEach(({ node, kind }) => {
				node.outOfFlow = kind;
			});
			flow = remaining;
		} else return {
			childMargins: {},
			fallbackToAbsolute: true,
			fallbackReason: "stage14-T1"
		};
	}
	if (hasTrigger(triggers, "T7")) return {
		childMargins: {},
		fallbackToAbsolute: true,
		fallbackReason: "stage14-T7"
	};
	const overflowMax = detectOverflowMax(parent, flow);
	if (overflowMax > OVERFLOW_SOFT_LIMIT && !(opts.isRoot && isRootLongContentOverflow(parent, flow, parent.children ?? flowInput))) return {
		childMargins: {},
		fallbackToAbsolute: true,
		fallbackReason: "stage14-T2-large"
	};
	const overflowVisible = overflowMax > 0;
	if (flow.length < 2) {
		const direction = pickDirection(parent, flow, opts.isRoot);
		if (!direction) return {
			childMargins: {},
			fallbackToAbsolute: true,
			fallbackReason: "stage14-direction-unknown"
		};
		if (flow.length === 1) {
			const child = flow[0];
			const padding = inferPadding(parent, flow);
			const left = child.geometry.x - parent.geometry.x;
			const top = child.geometry.y - parent.geometry.y;
			const contentW = parent.geometry.width - padding.left - padding.right;
			const contentH = parent.geometry.height - padding.top - padding.bottom;
			const expectedCenterX = padding.left + (contentW - child.geometry.width) / 2;
			const expectedCenterY = padding.top + (contentH - child.geometry.height) / 2;
			const isCentered = Math.abs(left - expectedCenterX) <= 1 && Math.abs(top - expectedCenterY) <= 1;
			const expectedRight = padding.left + (contentW - child.geometry.width);
			const isAtRightEdge = Math.abs(left - expectedRight) <= 1;
			const expectedBottom = padding.top + (contentH - child.geometry.height);
			const isAtBottomEdge = Math.abs(top - expectedBottom) <= 1;
			const isAtTopLeft = Math.abs(left - padding.left) <= 1 && Math.abs(top - padding.top) <= 1;
			if (isCentered || isAtRightEdge || isAtBottomEdge || isAtTopLeft) {
				const layout = {
					mode: "flex",
					direction,
					...nonZeroPaddingEntry(padding)
				};
				const childMargins = {};
				const margin = {};
				const leftOk = assignMargin(margin, "marginLeft", left - padding.left, 0);
				const topOk = assignMargin(margin, "marginTop", top - padding.top, 0);
				if (!leftOk || !topOk) return {
					childMargins: {},
					fallbackToAbsolute: true,
					fallbackReason: "stage14-negative-margin"
				};
				if (Object.keys(margin).length > 0) childMargins[child.id] = margin;
				return {
					layout,
					childMargins,
					fallbackToAbsolute: false,
					overflowVisible
				};
			}
			return {
				childMargins: {},
				fallbackToAbsolute: true,
				fallbackReason: "stage14-C2-no-idiom"
			};
		}
		return {
			childMargins: {},
			fallbackToAbsolute: true,
			fallbackReason: "stage14-empty"
		};
	}
	const direction = pickDirection(parent, flow, opts.isRoot);
	if (!direction) return {
		childMargins: {},
		fallbackToAbsolute: true,
		fallbackReason: "stage14-direction-unknown"
	};
	const padding = inferPadding(parent, flow);
	const gapDecision = inferGap(flow, direction);
	const ordered = opts.paintOrder === "html" ? flow : [...flow].sort((a, b) => direction === "row" ? a.geometry.x - b.geometry.x : a.geometry.y - b.geometry.y);
	let cursor = direction === "row" ? padding.left : padding.top;
	const gapValue = gapDecision.kind === "uniform" ? gapDecision.value : 0;
	const childMargins = {};
	for (let i = 0; i < ordered.length; i++) {
		const child = ordered[i];
		const childMain = direction === "row" ? child.geometry.x - parent.geometry.x : child.geometry.y - parent.geometry.y;
		const childCross = direction === "row" ? child.geometry.y - parent.geometry.y : child.geometry.x - parent.geometry.x;
		const crossPad = direction === "row" ? padding.top : padding.left;
		const mainResidual = childMain - cursor;
		const crossResidual = childCross - crossPad;
		const childSize = direction === "row" ? child.geometry.width : child.geometry.height;
		const contentMainEnd = direction === "row" ? parent.geometry.width - padding.right : parent.geometry.height - padding.bottom;
		const isLastChildAnchoredToEnd = opts.isRoot && direction === "column" && padding.bottom > 0 && i === ordered.length - 1 && mainResidual > .5 && Math.abs(childMain + childSize - contentMainEnd) <= 1;
		const margin = {};
		const minMainMargin = opts.isRoot ? ROOT_NEGATIVE_EDGE_GRAZE_MARGIN_LIMIT : 0;
		const mainMarginKey = direction === "row" ? "marginLeft" : "marginTop";
		const mainOk = isLastChildAnchoredToEnd ? (margin[mainMarginKey] = "auto", true) : assignMargin(margin, mainMarginKey, mainResidual, minMainMargin);
		const crossOk = assignMargin(margin, direction === "row" ? "marginTop" : "marginLeft", crossResidual, 0);
		if (!mainOk || !crossOk) return {
			childMargins: {},
			fallbackToAbsolute: true,
			fallbackReason: "stage14-negative-margin"
		};
		if (Object.keys(margin).length > 0) childMargins[child.id] = margin;
		cursor = childMain + childSize + gapValue;
	}
	if (!opts.isRoot && hasNegativeFlexMargin(childMargins)) return {
		childMargins: {},
		fallbackToAbsolute: true,
		fallbackReason: "stage14-negative-margin"
	};
	return {
		layout: {
			mode: "flex",
			direction,
			...nonZeroPaddingEntry(padding),
			...gapDecision.kind === "uniform" && gapDecision.value > 0 ? { gap: gapDecision.value } : {}
		},
		childMargins,
		fallbackToAbsolute: false,
		overflowVisible
	};
}
function hasNegativeFlexMargin(childMargins) {
	return Object.values(childMargins).some((flow) => typeof flow.marginTop === "number" && flow.marginTop < 0 || typeof flow.marginLeft === "number" && flow.marginLeft < 0);
}
function assignMargin(margin, key, residual, minAllowed) {
	if (Math.abs(residual) <= .5) return true;
	const rounded = Math.round(residual);
	if (rounded < 0) {
		if (rounded < minAllowed) return false;
		margin[key] = rounded;
		return true;
	}
	if (rounded > 0) margin[key] = rounded;
	return true;
}
//#endregion
//#region src/pipeline/stage14-layout/phaseA.ts
var D2_SKIP_ROLES = new Set([
	"modal",
	"toast",
	"fixed-nav",
	"overlay"
]);
function applyPhaseAToTree(root, opts) {
	walk$1(root, opts, true);
}
function walk$1(node, opts, isRoot) {
	node.children?.forEach((c) => walk$1(c, opts, false));
	if (!node.children || node.children.length === 0) return;
	if (node.semantic?.role && D2_SKIP_ROLES.has(node.semantic.role)) return;
	if (node.layout?.mode === "flex" && node.layout.direction !== void 0 && node.layout.padding !== void 0) return;
	const flow = node.children.filter((c) => !isOutOfFlow(c));
	const result = inferContainerLayout(node, flow, {
		paintOrder: opts.paintOrder,
		isRoot
	});
	if (result.fallbackToAbsolute) {
		if (result.fallbackReason) {
			const existing = node.layout?.hintConflicts ?? [];
			const newConflict = {
				field: "mode",
				hint: "flex",
				inferred: "absolute",
				reason: result.fallbackReason
			};
			node.layout = {
				mode: "absolute",
				hintConflicts: [...existing, newConflict]
			};
		}
		return;
	}
	if (result.layout) node.layout = result.layout;
	for (const child of flow) {
		const margin = result.childMargins[child.id];
		if (margin && Object.keys(margin).length > 0) child.flexFlow = margin;
	}
}
//#endregion
//#region src/pipeline/stage14-layout/rewriteRules.ts
/** Same out-of-flow filter used by Phase A / the renderer. */
function inFlow(c) {
	return !isOutOfFlow(c);
}
function isVirtualLayoutContainer(node) {
	const kind = node.virtualContainer?.kind;
	return kind === "row-container" || kind === "column-container";
}
function rewriteAlignCenter(parent) {
	if (parent.layout?.mode !== "flex" || parent.layout.direction !== "column") return { applied: false };
	const flow = parent.children?.filter(inFlow) ?? [];
	if (flow.length === 0) return { applied: false };
	const padding = parent.layout.padding ?? {
		top: 0,
		right: 0,
		bottom: 0,
		left: 0
	};
	const contentW = parent.geometry.width - padding.left - padding.right;
	if (!flow.every((c) => {
		const m = c.flexFlow?.marginLeft;
		const expected = (contentW - c.geometry.width) / 2;
		const actualLeft = c.geometry.x - parent.geometry.x;
		return (typeof m === "number" ? Math.abs(m - expected) <= 1 : m === void 0 && Math.abs(expected) <= 1) && Math.abs(actualLeft - (padding.left + expected)) <= 1;
	})) return { applied: false };
	const oldAlign = parent.layout.align;
	const snapshot = flow.map((c) => ({
		id: c.id,
		marginLeft: c.flexFlow?.marginLeft
	}));
	const undo = () => {
		if (parent.layout?.mode === "flex") parent.layout.align = oldAlign;
		flow.forEach((c) => {
			const s = snapshot.find((x) => x.id === c.id);
			if (s && c.flexFlow) c.flexFlow.marginLeft = s.marginLeft;
		});
	};
	if (parent.layout?.mode === "flex") parent.layout.align = "center";
	flow.forEach((c) => {
		if (c.flexFlow) delete c.flexFlow.marginLeft;
	});
	return {
		applied: true,
		undo
	};
}
function rewriteItemAutoCenter(parent) {
	if (parent.layout?.mode !== "flex" || parent.layout.direction !== "column") return { applied: false };
	if (isVirtualLayoutContainer(parent)) return { applied: false };
	const align = parent.layout.align;
	if (align !== void 0 && align !== "flex-start") return { applied: false };
	const flow = parent.children?.filter(inFlow) ?? [];
	if (flow.length === 0) return { applied: false };
	const padding = parent.layout.padding ?? {
		top: 0,
		right: 0,
		bottom: 0,
		left: 0
	};
	const contentW = parent.geometry.width - padding.left - padding.right;
	if (contentW <= 0) return { applied: false };
	const children = parent.children;
	if (!children) return { applied: false };
	const childSnapshots = children.map(snapshotSubtree);
	const oldChildren = [...children];
	let applied = false;
	const wrappers = /* @__PURE__ */ new Map();
	for (const child of flow) {
		const marginLeft = child.flexFlow?.marginLeft;
		if (typeof marginLeft !== "number") continue;
		const expectedMarginLeft = (contentW - child.geometry.width) / 2;
		if (expectedMarginLeft < 0) continue;
		const actualLeft = child.geometry.x - parent.geometry.x;
		const expectedLeft = padding.left + expectedMarginLeft;
		if (Math.abs(marginLeft - expectedMarginLeft) > 1 || Math.abs(actualLeft - expectedLeft) > 1) continue;
		const wrapper = createCenterWrapper(parent, child, padding.left, contentW);
		wrappers.set(child.id, wrapper);
		applied = true;
	}
	if (!applied) return { applied: false };
	parent.children = children.map((child) => wrappers.get(child.id) ?? child);
	const undo = () => {
		parent.children = oldChildren;
		childSnapshots.flat().forEach(({ node, parentId, depth, flexFlow }) => {
			node.parentId = parentId;
			node.depth = depth;
			node.flexFlow = cloneFlexFlow(flexFlow);
		});
	};
	return {
		applied: true,
		undo
	};
}
function createCenterWrapper(parent, child, paddingLeft, contentW) {
	const wrapperId = `${child.id}__center_wrapper`;
	const originalFlexFlow = cloneFlexFlow(child.flexFlow);
	const wrapperFlexFlow = {};
	if (originalFlexFlow?.marginTop !== void 0) wrapperFlexFlow.marginTop = originalFlexFlow.marginTop;
	child.flexFlow = void 0;
	const wrapperDepth = parent.depth + 1;
	shiftDepth(child, wrapperDepth + 1 - child.depth);
	child.parentId = wrapperId;
	return {
		id: wrapperId,
		name: `${child.name} center wrapper`,
		type: "FRAME",
		geometry: {
			x: parent.geometry.x + paddingLeft,
			y: child.geometry.y,
			width: contentW,
			height: child.geometry.height
		},
		depth: wrapperDepth,
		zIndex: child.zIndex,
		renderOrder: child.renderOrder,
		sourcePaintOrder: child.sourcePaintOrder,
		parentId: parent.id,
		layout: {
			mode: "flex",
			direction: "column",
			align: "center"
		},
		...Object.keys(wrapperFlexFlow).length > 0 ? { flexFlow: wrapperFlexFlow } : {},
		children: [child],
		virtualContainer: {
			kind: "center-wrapper",
			wrappedNodeIds: [child.id],
			reason: "stage14-item-auto-center"
		}
	};
}
function cloneFlexFlow(flexFlow) {
	return flexFlow ? { ...flexFlow } : void 0;
}
function shiftDepth(node, delta) {
	if (delta === 0) return;
	node.depth += delta;
	node.children?.forEach((child) => shiftDepth(child, delta));
}
function snapshotSubtree(node) {
	return [{
		node,
		parentId: node.parentId,
		depth: node.depth,
		flexFlow: cloneFlexFlow(node.flexFlow)
	}, ...(node.children ?? []).flatMap(snapshotSubtree)];
}
function rewriteSpaceBetween(parent) {
	if (parent.layout?.mode !== "flex" || parent.layout.direction !== "row") return { applied: false };
	const flow = parent.children?.filter(inFlow) ?? [];
	if (flow.length < 2) return { applied: false };
	const padding = parent.layout.padding ?? {
		top: 0,
		right: 0,
		bottom: 0,
		left: 0
	};
	const contentW = parent.geometry.width - padding.left - padding.right;
	const firstX = flow[0].geometry.x - parent.geometry.x;
	if (Math.abs(firstX - padding.left) > 1) return { applied: false };
	const last = flow[flow.length - 1];
	const lastEnd = last.geometry.x - parent.geometry.x + last.geometry.width;
	if (Math.abs(lastEnd - (padding.left + contentW)) > 1) return { applied: false };
	if (flow.reduce((s, c) => s + c.geometry.width, 0) > contentW + 1) return { applied: false };
	const oldJustify = parent.layout.justify;
	const oldGap = parent.layout.gap;
	const oldMargins = flow.map((c) => ({
		id: c.id,
		marginLeft: c.flexFlow?.marginLeft
	}));
	const undo = () => {
		if (parent.layout?.mode === "flex") {
			parent.layout.justify = oldJustify;
			parent.layout.gap = oldGap;
		}
		flow.forEach((c) => {
			const s = oldMargins.find((x) => x.id === c.id);
			if (s && c.flexFlow) c.flexFlow.marginLeft = s.marginLeft;
		});
	};
	if (parent.layout?.mode === "flex") {
		parent.layout.justify = "space-between";
		delete parent.layout.gap;
	}
	flow.forEach((c) => {
		if (c.flexFlow) delete c.flexFlow.marginLeft;
	});
	return {
		applied: true,
		undo
	};
}
function rewritePaddingAbsorb(parent) {
	if (parent.layout?.mode !== "flex") return { applied: false };
	const flow = parent.children?.filter(inFlow) ?? [];
	if (flow.length < 1) return { applied: false };
	const isRow = parent.layout.direction === "row";
	const crossKey = isRow ? "marginTop" : "marginLeft";
	const paddingKey = isRow ? "top" : "left";
	const firstMargin = flow[0].flexFlow?.[crossKey];
	if (typeof firstMargin !== "number" || firstMargin <= 0) return { applied: false };
	if (!flow.every((c) => c.flexFlow?.[crossKey] === firstMargin)) return { applied: false };
	const oldPadding = parent.layout.padding ? { ...parent.layout.padding } : {
		top: 0,
		right: 0,
		bottom: 0,
		left: 0
	};
	const oldMargins = flow.map((c) => ({
		id: c.id,
		m: c.flexFlow?.[crossKey]
	}));
	const undo = () => {
		if (parent.layout?.mode === "flex") parent.layout.padding = oldPadding;
		flow.forEach((c) => {
			const s = oldMargins.find((x) => x.id === c.id);
			if (s && c.flexFlow) c.flexFlow[crossKey] = s.m;
		});
	};
	parent.layout.padding = {
		...oldPadding,
		[paddingKey]: oldPadding[paddingKey] + firstMargin
	};
	flow.forEach((c) => {
		if (c.flexFlow) delete c.flexFlow[crossKey];
	});
	return {
		applied: true,
		undo
	};
}
/**
* R6: true common-gap rewrite rule。
* 只有非首 flow children 的 main-axis margin 近似一致时，才把 min(margins)
* 提到 layout.gap；否则保留 per-child margin，避免把非均匀间距硬凑成
* gap + residual offset。
* 跟 R5 padding-absorb 互为对偶（cross-axis padding-absorb / main-axis gap-absorb）。
*
* 守卫：
* - flex 容器 / gap 未设（=== undefined）/ 无 idiom justify
* - ≥ 3 flow children / ≥ 2 个非零非首 main-axis margin
*
* 等价性 rollback 由 applyPhaseBToTree walker 保证。
*/
function rewriteCommonGap(parent) {
	if (parent.layout?.mode !== "flex") return { applied: false };
	if (parent.layout.gap !== void 0) return { applied: false };
	const justify = parent.layout.justify;
	if (justify === "space-between" || justify === "space-around" || justify === "space-evenly" || justify === "center") return { applied: false };
	const mainKey = parent.layout.direction === "row" ? "marginLeft" : "marginTop";
	const flow = parent.children?.filter((c) => !isOutOfFlow(c)) ?? [];
	if (flow.length < 3) return { applied: false };
	const numericGaps = flow.slice(1).map((c) => c.flexFlow?.[mainKey]).map((m) => typeof m === "number" ? m : 0);
	if (numericGaps.filter((g) => g > 0).length < 2) return { applied: false };
	const baseGap = Math.min(...numericGaps);
	if (baseGap <= 0) return { applied: false };
	if (Math.max(...numericGaps) - baseGap > 1) return { applied: false };
	const oldGap = parent.layout.gap;
	const oldMargins = flow.slice(1).map((c) => ({
		id: c.id,
		m: c.flexFlow?.[mainKey]
	}));
	const undo = () => {
		if (parent.layout?.mode === "flex") parent.layout.gap = oldGap;
		flow.slice(1).forEach((c) => {
			const s = oldMargins.find((x) => x.id === c.id);
			if (s && c.flexFlow) c.flexFlow[mainKey] = s.m;
		});
	};
	parent.layout.gap = baseGap;
	flow.slice(1).forEach((c, i) => {
		const residual = numericGaps[i] - baseGap;
		if (!c.flexFlow) c.flexFlow = {};
		if (Math.abs(residual) <= .5) delete c.flexFlow[mainKey];
		else c.flexFlow[mainKey] = Math.round(residual);
	});
	return {
		applied: true,
		undo
	};
}
//#endregion
//#region src/pipeline/stage14-layout/phaseB.ts
var ORDER = [
	rewritePaddingAbsorb,
	rewriteCommonGap,
	rewriteAlignCenter,
	rewriteItemAutoCenter,
	rewriteSpaceBetween
];
var EQUIVALENCE_TOLERANCE = 1;
function applyPhaseBToTree(root) {
	walk(root);
}
function walk(node) {
	if (node.layout?.mode === "flex" && (node.children?.length ?? 0) > 0) for (const rule of ORDER) {
		const result = rule(node);
		if (!result.applied) continue;
		if (computedDriftedFromGeometry(snapshotComputedBboxes(node), node.children, EQUIVALENCE_TOLERANCE)) result.undo?.();
	}
	node.children?.forEach((c) => walk(c));
}
/**
* Simulate where each in-flow child would render based on the *current* layout
* fields (after a rewrite rule has mutated them). Returns a map of child.id →
* [absX, absY, width, height].
*/
function snapshotComputedBboxes(parent) {
	const m = /* @__PURE__ */ new Map();
	if (parent.layout?.mode !== "flex") return m;
	const direction = parent.layout.direction ?? "column";
	const padding = parent.layout.padding ?? {
		top: 0,
		right: 0,
		bottom: 0,
		left: 0
	};
	const gap = parent.layout.gap ?? 0;
	const justify = parent.layout.justify;
	const align = parent.layout.align;
	const flow = parent.children?.filter((c) => !isOutOfFlow(c)) ?? [];
	const contentMain = direction === "row" ? parent.geometry.width - padding.left - padding.right : parent.geometry.height - padding.top - padding.bottom;
	const contentCross = direction === "row" ? parent.geometry.height - padding.top - padding.bottom : parent.geometry.width - padding.left - padding.right;
	const remainingMain = contentMain - (flow.reduce((s, c) => s + (direction === "row" ? c.geometry.width : c.geometry.height), 0) + Math.max(0, flow.length - 1) * gap);
	let cursor = direction === "row" ? padding.left : padding.top;
	if (justify === "center") cursor += remainingMain / 2;
	const sbExtraGap = justify === "space-between" && flow.length > 1 ? remainingMain / (flow.length - 1) : 0;
	for (let i = 0; i < flow.length; i++) {
		const c = flow[i];
		const ml = c.flexFlow?.marginLeft;
		const mr = c.flexFlow?.marginRight;
		const mt = c.flexFlow?.marginTop;
		let main = cursor;
		if (direction === "row") {
			if (ml === "auto") main = padding.left + contentMain - c.geometry.width;
			else if (typeof ml === "number") main = cursor + ml;
		} else if (mt === "auto") main = padding.top + contentMain - c.geometry.height;
		else if (typeof mt === "number") main = cursor + mt;
		let cross = direction === "row" ? padding.top : padding.left;
		if (align === "center") cross += (contentCross - (direction === "row" ? c.geometry.height : c.geometry.width)) / 2;
		else if (align === "flex-end") cross = (direction === "row" ? padding.top : padding.left) + contentCross - (direction === "row" ? c.geometry.height : c.geometry.width);
		else {
			const crossMargin = direction === "row" ? mt : ml;
			if (direction === "column" && ml === "auto" && mr === "auto") cross += (contentCross - c.geometry.width) / 2;
			else if (typeof crossMargin === "number") cross += crossMargin;
		}
		if (direction === "row") {
			m.set(c.id, [
				parent.geometry.x + main,
				parent.geometry.y + cross,
				c.geometry.width,
				c.geometry.height
			]);
			cursor = main + c.geometry.width + gap + sbExtraGap;
		} else {
			m.set(c.id, [
				parent.geometry.x + cross,
				parent.geometry.y + main,
				c.geometry.width,
				c.geometry.height
			]);
			cursor = main + c.geometry.height + gap + sbExtraGap;
		}
	}
	return m;
}
/**
* Returns true if any in-flow child's computed position diverges from its
* recorded geometry.x/y by more than `tol` pixels.
*/
function computedDriftedFromGeometry(computed, children, tol) {
	for (const c of children) {
		if (isOutOfFlow(c)) continue;
		const cv = computed.get(c.id);
		if (!cv) continue;
		if (Math.abs(cv[0] - c.geometry.x) > tol) return true;
		if (Math.abs(cv[1] - c.geometry.y) > tol) return true;
	}
	return false;
}
//#endregion
//#region src/pipeline/stage14-layout/rowColumnFolding.ts
var MIN_AXIS_OVERLAP_RATIO = .5;
/**
* Stage14 row/column cutting refinement.
*
* A virtual row bbox is the union of its real children, so it can include empty
* space beneath one child. When later siblings sit in that empty space and align
* with a row child, they belong in that child's column instead of being treated
* as overlays on the row.
*/
function foldRowAlignedSiblingsIntoColumns(root) {
	foldRowsInParent(root);
}
function foldRowsInParent(parent) {
	parent.children?.forEach(foldRowsInParent);
	const children = parent.children;
	if (!children || children.length < 2) return;
	const removed = /* @__PURE__ */ new Set();
	for (let rowIndex = 0; rowIndex < children.length; rowIndex++) {
		const row = children[rowIndex];
		if (!isVirtualRow(row) || !row.children || row.children.length < 2) continue;
		const assignments = /* @__PURE__ */ new Map();
		for (let siblingIndex = rowIndex + 1; siblingIndex < children.length; siblingIndex++) {
			const sibling = children[siblingIndex];
			if (removed.has(sibling)) continue;
			const target = findColumnTarget(row, sibling);
			if (!target) continue;
			const list = assignments.get(target) ?? [];
			list.push(sibling);
			assignments.set(target, list);
			removed.add(sibling);
		}
		if (assignments.size === 0) continue;
		row.children = row.children.map((child, childIndex) => {
			const absorbed = assignments.get(child);
			if (!absorbed || absorbed.length === 0) return child;
			return createRowChildColumn(row, child, absorbed, childIndex);
		});
	}
	if (removed.size > 0) parent.children = children.filter((child) => !removed.has(child));
}
function isVirtualRow(node) {
	return node.virtualContainer?.kind === "row-container";
}
function findColumnTarget(row, candidate) {
	if (!isContainedBy(candidate.geometry, row.geometry)) return void 0;
	if ((row.children ?? []).some((child) => isContainedBy(candidate.geometry, child.geometry))) return;
	let best;
	for (const child of row.children ?? []) {
		const ratio = xOverlapRatio(candidate.geometry, child.geometry);
		if (ratio < MIN_AXIS_OVERLAP_RATIO) continue;
		if (candidate.geometry.y < child.geometry.y + child.geometry.height - 1) continue;
		if (!best || ratio > best.ratio) best = {
			child,
			ratio
		};
	}
	return best?.child;
}
function xOverlapRatio(a, b) {
	const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
	if (overlap <= 0) return 0;
	return overlap / Math.max(1, Math.min(a.width, b.width));
}
function createRowChildColumn(row, anchor, absorbed, childIndex) {
	const columnChildren = [anchor, ...absorbed].sort((a, b) => a.geometry.y - b.geometry.y || a.geometry.x - b.geometry.x || a.renderOrder - b.renderOrder);
	return {
		id: `${row.id}__col${childIndex}`,
		name: `col ${childIndex + 1}`,
		type: "FRAME",
		geometry: unionGeometry$1(columnChildren),
		depth: row.depth + 1,
		zIndex: anchor.zIndex,
		renderOrder: anchor.renderOrder,
		sourcePaintOrder: anchor.sourcePaintOrder,
		parentId: row.id,
		children: columnChildren,
		virtualContainer: {
			kind: "column-container",
			wrappedNodeIds: columnChildren.map((child) => child.id),
			reason: "row-child-column-folding"
		}
	};
}
function unionGeometry$1(nodes) {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const node of nodes) {
		minX = Math.min(minX, node.geometry.x);
		minY = Math.min(minY, node.geometry.y);
		maxX = Math.max(maxX, node.geometry.x + node.geometry.width);
		maxY = Math.max(maxY, node.geometry.y + node.geometry.height);
	}
	return {
		x: minX,
		y: minY,
		width: maxX - minX,
		height: maxY - minY
	};
}
//#endregion
//#region src/pipeline/stage14-layout/reparentOverlapping.ts
/**
* stage14 T1 rescue pass — runs AFTER applyPhaseAToTree (and stage14 A2/A3 overlay extraction
* inside it). Targets containers PhaseA left as `mode: 'absolute'` with a T1 (substantial
* overlap) reason. Tries two rescue strategies in turn:
*
*   1. applyReparentOverlapping — for each such container, find sibling pairs (X, Y) where
*      X geometrically fully contains Y (intersect / area(Y) >= 0.95) AND X is not an
*      excluded container type AND Y is not lower than X in original source paint order.
*      Move Y into X as a child, re-run inferContainerLayout on both X and the container.
*      If the container can now flex, accept the new layout.
*
*   2. applyOverlayStackExtraction — for remaining T1-fallback containers, find a near-
*      identical twin-icon pair (edge ratio < 1.2, overlap >= 0.9) and stamp the
*      later-painted child with outOfFlow='stage14-overlay-stack'. Re-run
*      inferContainerLayout; if the container can now flex, accept.
*
* Both passes only run on T1-fallback containers, so A2/A3 always gets first shot to
* tag overlay-leaf decorations. Reparent will not "steal" A3 candidates because A3 has
* already extracted them by the time this pass runs.
*
* Iteration: within a single container, reparent iterates to convergence (max 10) because
* conservative-skip can leave chains unresolved in a single pass.
*/
var FULL_CONTAIN_THRESHOLD = .95;
var MAX_REPARENT_ITERATIONS = 10;
var DRIFT_TOLERANCE_PX = 2;
var BLOCK_PATTERN = /__block\d*(?:_row|_col)/;
var STACK_EDGE_RATIO_MAX = 1.2;
var STACK_OVERLAP_MIN = .9;
/**
* Returns true if node X is excluded from being a reparent target container.
*
* Exclusion conditions:
* 1. imageRole is set AND no children (image leaf)
* 2. virtualContainer?.kind === 'background-container'
* 3. id or name matches /__block\d*(_row|_col)/ (stage7 synthesized block)
* 4. type === 'TEXT' — TEXT cannot host positioned children; nesting a sibling into a
*    Text node makes downstream ArkUI/HTML renderers treat the child as an inline span,
*    which collapses to the parent's start position (e.g., 步 nested into 7436 lands
*    at 7436's top-left instead of its own bbox).
*
* Note: A3-eligible nodes (leaf or all-SUPPOSITIONAL children) are NOT excluded here
* because this pass runs AFTER PhaseA — A3 has already had its shot. Any A3 candidate
* that survived is one A3 declined to tag (e.g., because the pair didn't match A3's
* own gating), so it's safe for us to reparent.
*/
function isReparentExcludedAsContainer(x) {
	if (x.imageRole && (x.children?.length ?? 0) === 0) return true;
	if (x.virtualContainer?.kind === "background-container") return true;
	if (BLOCK_PATTERN.test(x.id) || BLOCK_PATTERN.test(x.name)) return true;
	if (x.type === "TEXT") return true;
	return false;
}
/**
* Walks the post-PhaseA tree. For each container PhaseA left as `mode: 'absolute'` with
* a T1 reason, runs the full-contain reparent algorithm iteratively, then re-infers the
* container's layout. If the container can now flex (or absorbed children let X flex
* internally), the new layout is applied.
*/
function applyReparentOverlapping(root) {
	walkRescue(root);
}
function walkRescue(node) {
	node.children?.forEach(walkRescue);
	if (!isT1FallbackContainer(node)) return;
	let totalMoves = 0;
	for (let iter = 0; iter < MAX_REPARENT_ITERATIONS; iter++) {
		const moved = reparentInContainer(node);
		if (moved === 0) break;
		totalMoves += moved;
		if (iter === MAX_REPARENT_ITERATIONS - 1) console.warn(`[reparent] hit max iterations (${MAX_REPARENT_ITERATIONS}) on ${node.id}`);
	}
	if (totalMoves === 0) return;
	for (const child of node.children ?? []) if (child.layout === void 0 && (child.children?.length ?? 0) > 0) {
		reinferContainer(child);
		walkRescue(child);
	}
	reinferContainer(node);
}
/**
* Post-PhaseA rescue: for T1-fallback containers, find a twin-icon stack pair and
* stamp the higher-renderOrder child with `outOfFlow='stage14-overlay-stack'`.
* If the container can then flex, apply the new layout.
*/
function applyOverlayStackExtraction(root) {
	walkOverlayStack(root);
}
function walkOverlayStack(node) {
	node.children?.forEach((c) => walkOverlayStack(c));
	if (!isT1FallbackContainer(node)) return;
	const flowChildren = (node.children ?? []).filter((c) => !isOutOfFlow(c));
	if (flowChildren.length < 2) return;
	let victim = null;
	outerLoop: for (let i = 0; i < flowChildren.length; i++) for (let j = i + 1; j < flowChildren.length; j++) {
		const A = flowChildren[i];
		const B = flowChildren[j];
		if (!A.geometry || !B.geometry) continue;
		const maxEdgeA = Math.max(A.geometry.width, A.geometry.height);
		const maxEdgeB = Math.max(B.geometry.width, B.geometry.height);
		if (Math.max(maxEdgeA, maxEdgeB) / Math.min(maxEdgeA, maxEdgeB) >= STACK_EDGE_RATIO_MAX) continue;
		const inter = intersectArea(A.geometry, B.geometry);
		const minArea = Math.min(bboxArea(A.geometry), bboxArea(B.geometry));
		if (minArea <= 0) continue;
		if (inter / minArea < STACK_OVERLAP_MIN) continue;
		victim = A.renderOrder > B.renderOrder ? A : B;
		break outerLoop;
	}
	if (!victim) return;
	const newFlowChildren = flowChildren.filter((c) => c !== victim);
	const result = inferContainerLayout(node, newFlowChildren, {
		paintOrder: "html",
		isRoot: false
	});
	if (result.fallbackToAbsolute !== false || !result.layout) return;
	victim.outOfFlow = "stage14-overlay-stack";
	node.layout = result.layout;
	for (const child of newFlowChildren) {
		const margin = result.childMargins[child.id];
		if (margin && Object.keys(margin).length > 0) child.flexFlow = margin;
	}
}
function isT1FallbackContainer(node) {
	if (node.layout?.mode !== "absolute") return false;
	return (node.layout.hintConflicts ?? []).some((hc) => typeof hc.reason === "string" && /T1|stage14-T1/.test(hc.reason));
}
function reinferContainer(node) {
	const flow = (node.children ?? []).filter((c) => !isOutOfFlow(c));
	if (flow.length === 0) return;
	const result = inferContainerLayout(node, flow, {
		paintOrder: "html",
		isRoot: false
	});
	if (result.fallbackToAbsolute === false && result.layout) {
		node.layout = result.layout;
		for (const child of flow) {
			const margin = result.childMargins[child.id];
			if (margin && Object.keys(margin).length > 0) child.flexFlow = margin;
		}
		return;
	}
	node.layout = {
		mode: "absolute",
		hintConflicts: [{
			field: "mode",
			hint: "flex",
			inferred: "absolute",
			reason: result.fallbackReason ?? "stage14-T1"
		}]
	};
}
/**
* Single-pass reparent within one container. Scans (X, Y) sibling pairs in `parent.children`,
* collects qualifying moves, applies them with per-move drift validation. Returns the
* number of moves actually applied (excludes drift-rolled-back moves).
*/
function reparentInContainer(parent) {
	const children = parent.children;
	if (!children || children.length < 2) return 0;
	const containmentMap = /* @__PURE__ */ new Map();
	for (let i = 0; i < children.length; i++) for (let j = 0; j < children.length; j++) {
		if (i === j) continue;
		const X = children[i];
		const Y = children[j];
		if (!X.geometry || !Y.geometry) continue;
		if (isReparentExcludedAsContainer(X)) continue;
		if (isSourcePaintedBelowOrEqual(Y, X)) continue;
		if (wouldInvertOutOfFlowOverlayPaintOrder(X, Y)) continue;
		const xa = bboxArea(X.geometry);
		const ya = bboxArea(Y.geometry);
		if (xa <= ya) continue;
		if (ya <= 0) continue;
		if (intersectArea(X.geometry, Y.geometry) / ya < FULL_CONTAIN_THRESHOLD) continue;
		const prev = containmentMap.get(Y.id);
		if (!prev || xa < prev.area) containmentMap.set(Y.id, {
			container: X,
			area: xa
		});
	}
	if (containmentMap.size === 0) return 0;
	const movingYIds = new Set(containmentMap.keys());
	for (const yId of Array.from(containmentMap.keys())) {
		const { container } = containmentMap.get(yId);
		if (movingYIds.has(container.id)) containmentMap.delete(yId);
	}
	if (containmentMap.size === 0) return 0;
	const moveQueue = /* @__PURE__ */ new Map();
	for (const [yId, { container }] of containmentMap) {
		const Y = children.find((c) => c.id === yId);
		let entry = moveQueue.get(container.id);
		if (!entry) {
			entry = {
				container,
				absorbed: []
			};
			moveQueue.set(container.id, entry);
		}
		entry.absorbed.push(Y);
	}
	const toRemoveIds = /* @__PURE__ */ new Set();
	let movedCount = 0;
	for (const { container, absorbed } of moveQueue.values()) {
		const accepted = [];
		for (const Y of absorbed) {
			if (!isWithinDriftTolerance(container, Y)) continue;
			accepted.push(Y);
		}
		if (accepted.length === 0) continue;
		container.children = [...container.children ?? [], ...accepted];
		container.layout = void 0;
		container.flexFlow = void 0;
		for (const Y of accepted) toRemoveIds.add(Y.id);
		movedCount += accepted.length;
	}
	if (movedCount === 0) return 0;
	parent.children = children.filter((c) => !toRemoveIds.has(c.id));
	parent.layout = void 0;
	parent.flexFlow = void 0;
	return movedCount;
}
function isSourcePaintedBelowOrEqual(candidateChild, candidateContainer) {
	const childOrder = candidateChild.sourcePaintOrder;
	const containerOrder = candidateContainer.sourcePaintOrder;
	return typeof childOrder === "number" && typeof containerOrder === "number" && childOrder <= containerOrder;
}
function wouldInvertOutOfFlowOverlayPaintOrder(candidateContainer, candidateChild) {
	const childOrder = paintRank$1(candidateChild);
	return (candidateContainer.children ?? []).some((containerChild) => isOutOfFlowOverlayLayer(containerChild) && paintRank$1(containerChild) < childOrder && intersectArea(containerChild.geometry, candidateChild.geometry) > 0);
}
function isOutOfFlowOverlayLayer(node) {
	if (!isOutOfFlow(node)) return false;
	return !isBackgroundImageLayer$1(node);
}
function paintRank$1(node) {
	return typeof node.sourcePaintOrder === "number" ? node.sourcePaintOrder : node.renderOrder;
}
function isWithinDriftTolerance(x, y) {
	const xg = x.geometry;
	const yg = y.geometry;
	const xLeft = xg.x, xTop = xg.y, xRight = xg.x + xg.width, xBottom = xg.y + xg.height;
	const yLeft = yg.x, yTop = yg.y, yRight = yg.x + yg.width, yBottom = yg.y + yg.height;
	if (xLeft - yLeft > DRIFT_TOLERANCE_PX) return false;
	if (yRight - xRight > DRIFT_TOLERANCE_PX) return false;
	if (xTop - yTop > DRIFT_TOLERANCE_PX) return false;
	if (yBottom - xBottom > DRIFT_TOLERANCE_PX) return false;
	return true;
}
function bboxArea(g) {
	return Math.max(0, g.width) * Math.max(0, g.height);
}
function intersectArea(a, b) {
	const x1 = Math.max(a.x, b.x);
	const y1 = Math.max(a.y, b.y);
	const x2 = Math.min(a.x + a.width, b.x + b.width);
	const y2 = Math.min(a.y + a.height, b.y + b.height);
	if (x2 <= x1 || y2 <= y1) return 0;
	return (x2 - x1) * (y2 - y1);
}
//#endregion
//#region src/pipeline/stage14-layout/index.ts
function parseDesignStage14(raw) {
	let root = parseDesignStage13(raw);
	stripMaskNodes(root);
	stripEmptyNonVisualLeafContainers(root);
	root = splitBackgroundContainerVisualLayers(root);
	stripDuplicateOverlappingTextLayers(root);
	fillHtmlOrderTreeMetadata(root);
	foldRowAlignedSiblingsIntoColumns(root);
	fillHtmlOrderTreeMetadata(root);
	applyPhaseAToTree(root, { paintOrder: "html" });
	applyReparentOverlapping(root);
	applyOverlayStackExtraction(root);
	fillHtmlOrderTreeMetadata(root);
	applyPhaseBToTree(root);
	return root;
}
function stripMaskNodes(node) {
	if (!node.children) return;
	const children = [];
	for (const child of node.children) {
		stripMaskNodes(child);
		if (isMaskOnlyNode(child)) children.push(...child.children ?? []);
		else children.push(child);
	}
	node.children = children;
}
function isMaskOnlyNode(node) {
	if (node.extend?.mask !== true) return false;
	if (isVisibleRasterContentImage(node)) return false;
	return node.imageRole !== "background" || hasMaskLikeName(node);
}
function isVisibleRasterContentImage(node) {
	return node.imageRole === "content" && node.imageSource === "raster" && Boolean(node.imageUrl);
}
function hasMaskLikeName(node) {
	return node.name.includes("蒙版") || /\bmask\b/i.test(node.name);
}
function stripEmptyNonVisualLeafContainers(node) {
	if (!node.children) return;
	const children = [];
	for (const child of node.children) {
		stripEmptyNonVisualLeafContainers(child);
		if (!isEmptyNonVisualLeafContainer(child)) children.push(child);
	}
	node.children = children;
}
function isEmptyNonVisualLeafContainer(node) {
	return (node.type === "FRAME" || node.type === "GROUP" || node.type === "INSTANCE" || node.type === "COMPONENT") && (node.children?.length ?? 0) === 0 && !node.imageRole && !node.imageUrl && !hasRenderableStyle(node);
}
function splitBackgroundContainerVisualLayers(node) {
	if (node.children) node.children = node.children.map(splitBackgroundContainerVisualLayers);
	if (!isBackgroundContainerWithContent(node)) return node;
	const children = node.children ?? [];
	const wrapperId = `${node.id}__background_container`;
	const backgroundLayer = {
		...node,
		children: void 0,
		virtualContainer: void 0,
		parentId: wrapperId
	};
	return {
		id: wrapperId,
		name: `${node.name} container`,
		type: "FRAME",
		geometry: unionGeometry([backgroundLayer, ...children]),
		depth: node.depth,
		zIndex: node.zIndex,
		renderOrder: node.renderOrder,
		parentId: node.parentId,
		children: [backgroundLayer, ...children],
		virtualContainer: {
			kind: "background-container",
			backgroundNodeId: node.id,
			wrappedNodeIds: children.map((child) => child.id),
			reason: "background-layer"
		}
	};
}
function isBackgroundContainerWithContent(node) {
	return node.imageRole === "background" && node.virtualContainer?.kind === "background-container" && (node.children?.length ?? 0) > 0;
}
function unionGeometry(nodes) {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const node of nodes) {
		const geometry = node.geometry;
		minX = Math.min(minX, geometry.x);
		minY = Math.min(minY, geometry.y);
		maxX = Math.max(maxX, geometry.x + geometry.width);
		maxY = Math.max(maxY, geometry.y + geometry.height);
	}
	return {
		x: minX,
		y: minY,
		width: maxX - minX,
		height: maxY - minY
	};
}
function hasRenderableStyle(node) {
	const style = node.style;
	return Boolean(style?.backgroundColor || style?.backgroundImage || style?.border || style?.borderTop || style?.borderRight || style?.borderBottom || style?.borderLeft || style?.boxShadow || style?.filter || style?.backdropFilter);
}
function stripDuplicateOverlappingTextLayers(node) {
	if (!node.children) return;
	node.children.forEach(stripDuplicateOverlappingTextLayers);
	const keptOpaqueTextLayers = [];
	const keep = /* @__PURE__ */ new Set();
	const childrenByPaintOrder = [...node.children].sort((a, b) => b.renderOrder - a.renderOrder);
	for (const child of childrenByPaintOrder) {
		if (isDuplicateTextLayer(child, keptOpaqueTextLayers)) continue;
		keep.add(child);
		if (isSemanticTextLayer(child) && effectiveLayerAlpha(child) >= .5) keptOpaqueTextLayers.push(child);
	}
	node.children = node.children.filter((child) => keep.has(child));
}
function isDuplicateTextLayer(node, keptOpaqueTextLayers) {
	if (!isSemanticTextLayer(node)) return false;
	const text = normalizeText(node.characters);
	return keptOpaqueTextLayers.some((kept) => normalizeText(kept.characters) === text && minAreaOverlapRatio(kept.geometry, node.geometry) >= .95);
}
function isSemanticTextLayer(node) {
	return node.type === "TEXT" && Boolean(normalizeText(node.characters));
}
function normalizeText(value) {
	return value?.trim().replace(/\s+/g, " ") ?? "";
}
function fillHtmlOrderTreeMetadata(root) {
	let counter = 0;
	const walk = (node, depth, zIndex, parentId) => {
		node.depth = depth;
		node.zIndex = zIndex;
		node.renderOrder = counter++;
		node.parentId = parentId;
		node.children?.forEach((child, index) => walk(child, depth + 1, index, node.id));
	};
	walk(root, 0, 0, void 0);
}
//#endregion
//#region src/arkui/dsl-export.ts
var OCCLUSION_EPS = .5;
function rounded(value) {
	return Math.round(value * 100) / 100;
}
function pxNumber(value) {
	if (typeof value === "number") return value;
	if (typeof value !== "string") return void 0;
	const n = Number.parseFloat(value);
	return Number.isFinite(n) ? n : void 0;
}
function hexByte(value) {
	return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0").toUpperCase();
}
function alphaByte(value) {
	const n = Number.parseFloat(value);
	if (!Number.isFinite(n)) return void 0;
	if (value.trim().endsWith("%")) return hexByte(n / 100 * 255);
	return hexByte(n * 255);
}
function cssHexToArkUIHex(hex) {
	const raw = hex.slice(1);
	if (/^[0-9a-fA-F]{3}$/.test(raw)) {
		const [r, g, b] = raw;
		return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
	}
	if (/^[0-9a-fA-F]{4}$/.test(raw)) {
		const [r, g, b, a] = raw;
		return `#${a}${a}${r}${r}${g}${g}${b}${b}`.toUpperCase();
	}
	if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw}`.toUpperCase();
	if (/^[0-9a-fA-F]{8}$/.test(raw)) {
		const rr = raw.slice(0, 2);
		const gg = raw.slice(2, 4);
		const bb = raw.slice(4, 6);
		return `#${raw.slice(6, 8)}${rr}${gg}${bb}`.toUpperCase();
	}
	return hex;
}
function cssRgbToArkUIHex(value) {
	const match = value.trim().match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+%?))?\s*\)$/i);
	if (!match) return void 0;
	const rr = hexByte(Number(match[1]));
	const gg = hexByte(Number(match[2]));
	const bb = hexByte(Number(match[3]));
	const aa = match[4] === void 0 ? void 0 : alphaByte(match[4]);
	return aa ? `#${aa}${rr}${gg}${bb}` : `#${rr}${gg}${bb}`;
}
function arkUIColor(value) {
	const trimmed = value.trim();
	if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return cssHexToArkUIHex(trimmed);
	return cssRgbToArkUIHex(trimmed) ?? value;
}
function normalizeColorTokens(value) {
	return value.replace(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g, (color) => arkUIColor(color)).replace(/rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*[\d.]+%?)?\s*\)/gi, (color) => arkUIColor(color));
}
function isStableOctoId(id) {
	return /^\d+:\d+$/.test(id);
}
function resolvedImageOctoId(node, parent) {
	if (isStableOctoId(node.id)) return node.id;
	if (parent && isStableOctoId(parent.id)) return parent.id;
	return node.id;
}
function shouldEmitImageSrc(node) {
	return node.type === "IMAGE" || node.imageRole === "content" || node.imageSource !== void 0 || node.imageUrl !== void 0;
}
function pageName(sourcePath, root) {
	if (!sourcePath) return root.name;
	return sourcePath.split(/[\\/]/).at(-1)?.replace(/\.json$/i, "") || root.name;
}
function borderRadius(value) {
	if (!value) return void 0;
	const parts = value.trim().split(/\s+/).map(pxNumber);
	if (parts.some((part) => part === void 0)) return void 0;
	if (parts.length === 1) return rounded(parts[0]);
	if (parts.length === 2) return {
		topLeft: rounded(parts[0]),
		topRight: rounded(parts[1]),
		bottomRight: rounded(parts[0]),
		bottomLeft: rounded(parts[1])
	};
	if (parts.length === 3) return {
		topLeft: rounded(parts[0]),
		topRight: rounded(parts[1]),
		bottomRight: rounded(parts[2]),
		bottomLeft: rounded(parts[1])
	};
	if (parts.length === 4) return {
		topLeft: rounded(parts[0]),
		topRight: rounded(parts[1]),
		bottomRight: rounded(parts[2]),
		bottomLeft: rounded(parts[3])
	};
}
function border(value) {
	if (!value) return void 0;
	const match = value.trim().match(/^([\d.]+)px\s+(solid|dashed|dotted)\s+(.+)$/i);
	if (!match) return void 0;
	const style = match[2].toLowerCase();
	return {
		width: rounded(Number(match[1])),
		color: arkUIColor(match[3]),
		style: style === "dashed" ? "Dashed" : style === "dotted" ? "Dotted" : "Solid"
	};
}
function isTransparentColor(value) {
	if (!value) return true;
	const trimmed = value.trim().toLowerCase();
	if (!trimmed || trimmed === "transparent" || trimmed === "none") return true;
	const rgb = trimmed.match(/rgba?\(([^)]+)\)/);
	if (rgb) {
		const parts = rgb[1].split(",").map((part) => Number.parseFloat(part.trim()));
		return parts.length === 4 && (Number.isNaN(parts[3]) || parts[3] <= 0);
	}
	return /^#[0-9a-f]{8}$/.test(trimmed) && trimmed.slice(-2) === "00";
}
function parseRadius(value) {
	if (!value) return [
		0,
		0,
		0,
		0
	];
	const [topLeft, topRight = topLeft, bottomRight = topLeft, bottomLeft = topRight] = value.trim().split(/\s+/).map((part) => Number.parseFloat(part) || 0);
	return [
		topLeft,
		topRight,
		bottomRight,
		bottomLeft
	];
}
function opaqueShapeCoversNode(cover, covered) {
	if (cover.geometry.rotation || covered.geometry.rotation) return false;
	if (!contains(cover.geometry, covered.geometry, OCCLUSION_EPS)) return false;
	const coverRadius = parseRadius(cover.style?.borderRadius);
	const coveredRadius = parseRadius(covered.style?.borderRadius);
	const marginLeft = covered.geometry.x - cover.geometry.x;
	const marginTop = covered.geometry.y - cover.geometry.y;
	const marginRight = cover.geometry.x + cover.geometry.width - (covered.geometry.x + covered.geometry.width);
	const marginBottom = cover.geometry.y + cover.geometry.height - (covered.geometry.y + covered.geometry.height);
	if (roundedCornerMayExpose(coverRadius[0], coveredRadius[0], marginLeft, marginTop)) return false;
	if (roundedCornerMayExpose(coverRadius[1], coveredRadius[1], marginRight, marginTop)) return false;
	if (roundedCornerMayExpose(coverRadius[2], coveredRadius[2], marginRight, marginBottom)) return false;
	if (roundedCornerMayExpose(coverRadius[3], coveredRadius[3], marginLeft, marginBottom)) return false;
	return true;
}
function roundedCornerMayExpose(coverRadius, coveredRadius, horizontalMargin, verticalMargin) {
	if (coverRadius <= OCCLUSION_EPS) return false;
	if (horizontalMargin >= coverRadius - OCCLUSION_EPS || verticalMargin >= coverRadius - OCCLUSION_EPS) return false;
	return coverRadius - Math.min(horizontalMargin, verticalMargin) > coveredRadius + OCCLUSION_EPS;
}
function isOpaqueOccluder(node) {
	if (node.type === "TEXT") return false;
	if (node.type === "IMAGE" && node.imageSource === "icon-font") return false;
	if (node.type === "IMAGE" && node.imageOpaque === false) return false;
	if (node.style?.opacity !== void 0 && node.style.opacity < 1) return false;
	if (node.style?.filter) return false;
	if (node.style?.backgroundImage && gradientHasTransparentStop(node.style.backgroundImage)) return false;
	const hasSolidColor = !isTransparentColor(node.style?.backgroundColor);
	const hasBackgroundImage = Boolean(node.style?.backgroundImage);
	const isImage = node.type === "IMAGE";
	return hasSolidColor || hasBackgroundImage || isImage;
}
function align(value) {
	if (value === void 0) return void 0;
	if (value === "center") return "Center";
	if (value === "flex-end") return "End";
	return "Start";
}
function justify(value) {
	if (value === "center") return "Center";
	if (value === "flex-end") return "End";
	if (value === "space-between") return "SpaceBetween";
	if (value === "space-around") return "SpaceAround";
	if (value === "flex-start") return "Start";
}
function textAlign(value) {
	if (value === "center") return "Center";
	if (value === "right") return "End";
	if (value === "left") return "Start";
	if (value === "justify") return "Justify";
}
function verticalAlign(value) {
	if (value === "top") return "Top";
	if (value === "middle") return "Center";
	if (value === "bottom") return "Bottom";
}
function layoutPositionStyles(node, root, placement) {
	if (placement === "absolute") return {
		position: "absolute",
		top: rounded(node.geometry.y - root.geometry.y),
		left: rounded(node.geometry.x - root.geometry.x)
	};
	return {};
}
function overflowValue(node, placement) {
	return node.clipDecision?.overflow ?? node.style?.overflow ?? (placement === "root" ? "hidden" : void 0);
}
function baseStyles(node, opts = {}) {
	const styles = {
		width: rounded(node.geometry.width),
		height: rounded(node.geometry.height),
		...opts.root && opts.placement ? layoutPositionStyles(node, opts.root, opts.placement) : {}
	};
	const style = node.style;
	if (style?.backgroundColor) styles.backgroundColor = arkUIColor(style.backgroundColor);
	if (style?.backgroundImage) if (/\b(?:repeating-)?(?:linear|radial|conic)-gradient\(/i.test(style.backgroundImage)) styles.linearGradient = normalizeColorTokens(style.backgroundImage);
	else styles.backgroundImage = style.backgroundImage;
	if (style?.backgroundSize) styles.backgroundSize = style.backgroundSize;
	if (style?.backgroundPosition) styles.backgroundPosition = style.backgroundPosition;
	if (style?.backgroundRepeat) styles.backgroundRepeat = style.backgroundRepeat;
	const overflow = overflowValue(node, opts.placement);
	if (overflow) styles.overflow = overflow;
	if (style?.opacity !== void 0) styles.opacity = style.opacity;
	const radius = borderRadius(style?.borderRadius);
	if (radius !== void 0) styles.borderRadius = radius;
	const borderStyle = border(style?.border);
	if (borderStyle) styles.border = borderStyle;
	const borderTop = border(style?.borderTop);
	if (borderTop) styles.borderTop = borderTop;
	const borderRight = border(style?.borderRight);
	if (borderRight) styles.borderRight = borderRight;
	const borderBottom = border(style?.borderBottom);
	if (borderBottom) styles.borderBottom = borderBottom;
	const borderLeft = border(style?.borderLeft);
	if (borderLeft) styles.borderLeft = borderLeft;
	if (style?.boxShadow) styles.boxShadow = style.boxShadow;
	if (style?.filter) styles.filter = style.filter;
	if (style?.backdropFilter) styles.backdropFilter = style.backdropFilter;
	const fontSize = pxNumber(style?.fontSize);
	if (fontSize !== void 0) styles.fontSize = rounded(fontSize);
	if (style?.color) styles.fontColor = arkUIColor(style.color);
	if (style?.fontWeight !== void 0) styles.fontWeight = style.fontWeight;
	if (style?.fontFamily) styles.fontFamily = style.fontFamily;
	const lineHeight = pxNumber(style?.lineHeight);
	if (lineHeight !== void 0) styles.lineHeight = rounded(lineHeight);
	const letterSpacing = pxNumber(style?.letterSpacing);
	if (letterSpacing !== void 0) styles.letterSpacing = rounded(letterSpacing);
	const textAlignValue = textAlign(style?.textAlign);
	if (textAlignValue) styles.textAlign = textAlignValue;
	const verticalAlignValue = verticalAlign(style?.verticalAlign);
	if (verticalAlignValue) styles.verticalAlign = verticalAlignValue;
	if (style?.textShadow) styles.textShadow = style.textShadow;
	if (opts.includeFlexLayout && node.layout?.mode === "flex") {
		if (node.layout.gap !== void 0) styles.space = rounded(node.layout.gap);
		if (node.layout.padding) styles.padding = node.layout.padding;
		const justifyContent = justify(node.layout.justify);
		if (justifyContent) styles.justifyContent = justifyContent;
		const alignItems = align(node.layout.align);
		if (alignItems) styles.alignItems = alignItems;
	}
	if (opts.placement !== "absolute") {
		if (node.flexFlow?.marginTop !== void 0) styles.marginTop = node.flexFlow.marginTop;
		if (node.flexFlow?.marginLeft !== void 0) styles.marginLeft = node.flexFlow.marginLeft;
		if (node.flexFlow?.marginRight !== void 0) styles.marginRight = node.flexFlow.marginRight;
	}
	return styles;
}
function parseDesignMark(value) {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}
function record(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function pixsoNodeId(node) {
	const guid = record(node.extend?.pixso)?.guid;
	return typeof guid === "string" && guid.length > 0 ? guid : void 0;
}
function meta(node, octoId = node.id, includePixsoProvenance = false) {
	const customMark = node.extend && Object.prototype.hasOwnProperty.call(node.extend, "custom_mark") ? node.extend.custom_mark : void 0;
	const designMark = node.extend && Object.prototype.hasOwnProperty.call(node.extend, "design_mark") ? parseDesignMark(node.extend.design_mark) : void 0;
	const sourcePixsoNodeId = pixsoNodeId(node);
	return {
		octoId,
		octoName: node.name,
		octoType: node.type,
		bbox: [
			rounded(node.geometry.x),
			rounded(node.geometry.y),
			rounded(node.geometry.x + node.geometry.width),
			rounded(node.geometry.y + node.geometry.height)
		],
		...includePixsoProvenance && sourcePixsoNodeId !== void 0 ? { pixsoNodeId: sourcePixsoNodeId } : {},
		...includePixsoProvenance && node.imageResourceNodeId !== void 0 ? { pixsoImageId: node.imageResourceNodeId } : {},
		...customMark !== void 0 ? { customMark } : {},
		...designMark !== void 0 ? { designMark } : {},
		...node.hints?.componentName ? { componentInfo: { componentName: node.hints.componentName } } : {}
	};
}
function componentName(node) {
	if (node.type === "TEXT") return "Text";
	if ((node.children?.length ?? 0) > 0) {
		if (needsPageForegroundStackExport(node)) return "Stack";
		if (needsLayeredStackExport(node)) return "Stack";
		if (node.layout?.mode === "flex") return node.layout.direction === "row" ? "Row" : "Column";
		return "Stack";
	}
	return shouldEmitImageSrc(node) ? "Image" : "Stack";
}
function needsLayeredStackExport(node) {
	if (node.isPageRoot) return false;
	const children = node.children ?? [];
	if (children.length < 2) return false;
	return children.some((child) => isOutOfFlow(child));
}
function needsPageForegroundStackExport(node) {
	if (!node.isPageRoot || node.layout?.mode !== "flex") return false;
	const children = (node.children ?? []).filter((child) => !isMaskOnlyNode(child));
	return children.some((child) => isBackgroundImageLayer$1(child)) && children.some((child) => !isOutOfFlow(child));
}
function stackChildOffset(parent, child) {
	const left = rounded(child.geometry.x - parent.geometry.x);
	const top = rounded(child.geometry.y - parent.geometry.y);
	return {
		...top !== 0 ? { marginTop: top } : {},
		...left !== 0 ? { marginLeft: left } : {}
	};
}
function childPlacement(parent, parentComponentName, child) {
	if (parentComponentName === "Stack") return "absolute";
	if (parent.layout?.mode === "flex" && isOutOfFlow(child)) return "absolute";
	return "flow";
}
function imageAssetPathForOctoId(octoId) {
	return `assets/${octoId.replace(/:/g, "_")}.png`;
}
function flowWrapperComponentName(node) {
	return node.layout?.mode === "flex" && node.layout.direction === "row" ? "Row" : "Column";
}
function flowWrapperStyles(node) {
	const styles = {
		width: rounded(node.geometry.width),
		height: rounded(node.geometry.height),
		position: "absolute",
		top: 0,
		left: 0
	};
	if (node.layout?.mode === "flex") {
		if (node.layout.gap !== void 0) styles.space = rounded(node.layout.gap);
		if (node.layout.padding) styles.padding = node.layout.padding;
		const justifyContent = justify(node.layout.justify);
		if (justifyContent) styles.justifyContent = justifyContent;
		const alignItems = align(node.layout.align);
		if (alignItems) styles.alignItems = alignItems;
	}
	return styles;
}
function flowWrapperMeta(node) {
	return {
		octoId: `${node.id}__foreground`,
		octoName: `${node.name} foreground`,
		octoType: "FRAME",
		bbox: [
			rounded(node.geometry.x),
			rounded(node.geometry.y),
			rounded(node.geometry.x + node.geometry.width),
			rounded(node.geometry.y + node.geometry.height)
		]
	};
}
function exportChild(parent, parentComponentName, child, opts, root) {
	const exported = designNodeToArkUiDslNode(child, opts, root, childPlacement(parent, parentComponentName, child), parent);
	if (parentComponentName === "Stack" && exported.styles?.position !== "absolute") exported.styles = {
		...exported.styles ?? {},
		...stackChildOffset(parent, child)
	};
	return exported;
}
function exportPageForegroundStackChildren(node, opts, root) {
	const children = (node.children ?? []).filter((child) => !isMaskOnlyNode(child));
	const backgroundLayers = children.filter((child) => isBackgroundImageLayer$1(child)).sort((a, b) => paintRank(a) - paintRank(b)).map((child) => exportChild(node, "Stack", child, opts, root));
	const flowChildren = children.filter((child) => !isOutOfFlow(child));
	const overlayLayers = children.filter((child) => isOutOfFlow(child) && !isBackgroundImageLayer$1(child)).sort((a, b) => paintRank(a) - paintRank(b)).map((child) => exportChild(node, "Stack", child, opts, root));
	const flowComponentName = flowWrapperComponentName(node);
	const foreground = {
		componentName: flowComponentName,
		styles: flowWrapperStyles(node),
		meta: flowWrapperMeta(node),
		children: flowChildren.map((child) => exportChild(node, flowComponentName, child, opts, root))
	};
	return [
		...backgroundLayers,
		foreground,
		...overlayLayers
	];
}
function exportChildren(node, parentComponentName, opts, root) {
	if (parentComponentName === "Stack" && needsPageForegroundStackExport(node)) return exportPageForegroundStackChildren(node, opts, root);
	const children = (node.children ?? []).filter((child) => !isMaskOnlyNode(child));
	return (parentComponentName === "Stack" ? stackLayoutOrderedChildren(children) : children).map((child) => exportChild(node, parentComponentName, child, opts, root));
}
function stackLayoutOrderedChildren(children) {
	const ordered = [...children].sort((a, b) => paintRank(a) - paintRank(b));
	const backgrounds = ordered.filter((child) => child.imageRole === "background" && child.backgroundLayer).sort((a, b) => paintRank(a) - paintRank(b));
	for (const background of backgrounds) {
		const backgroundIndex = ordered.indexOf(background);
		if (backgroundIndex < 0) continue;
		const targetIndex = ordered.findIndex((child) => child !== background && backgroundContainsNode(background, child));
		if (targetIndex < 0 || backgroundIndex < targetIndex) continue;
		ordered.splice(backgroundIndex, 1);
		ordered.splice(targetIndex, 0, background);
	}
	return ordered;
}
function paintRank(node) {
	return typeof node.sourcePaintOrder === "number" ? node.sourcePaintOrder : node.renderOrder;
}
function subtreeHasOpaqueCover(occluder, covered) {
	if (paintRank(occluder) > paintRank(covered) && isOpaqueOccluder(occluder) && opaqueShapeCoversNode(occluder, covered)) return true;
	return (occluder.children ?? []).some((child) => subtreeHasOpaqueCover(child, covered));
}
function pruneFullyCoveredStackChildrenForArkUi(node) {
	node.children?.forEach(pruneFullyCoveredStackChildrenForArkUi);
	const children = node.children;
	if (!children || children.length < 2) return;
	if (componentName(node) !== "Stack") return;
	const ordered = [...children].sort((a, b) => paintRank(a) - paintRank(b));
	const covered = /* @__PURE__ */ new Set();
	for (let i = 0; i < ordered.length; i++) {
		const candidate = ordered[i];
		if (candidate.geometry.width <= 0 || candidate.geometry.height <= 0 || candidate.geometry.rotation) continue;
		if (ordered.slice(i + 1).some((sibling) => subtreeHasOpaqueCover(sibling, candidate))) covered.add(candidate);
	}
	if (covered.size > 0) node.children = children.filter((child) => !covered.has(child));
}
function backgroundContainsNode(background, node) {
	const contained = background.backgroundLayer?.containedNodeIds;
	if (!contained || contained.length === 0) return false;
	if (contained.includes(node.id)) return true;
	const subtreeIds = collectSubtreeIds(node);
	return contained.some((id) => subtreeIds.has(id));
}
function collectSubtreeIds(node) {
	const ids = new Set([node.id]);
	for (const child of node.children ?? []) for (const id of collectSubtreeIds(child)) ids.add(id);
	return ids;
}
function designNodeToArkUiDslNode(node, opts = {}, root = node, placement = "root", parent) {
	const name = componentName(node);
	const children = exportChildren(node, name, opts, root);
	const octoId = name === "Image" ? resolvedImageOctoId(node, parent) : node.id;
	const ui = {
		componentName: name,
		styles: { ...baseStyles(node, {
			includeFlexLayout: name === "Row" || name === "Column",
			root,
			placement
		}) },
		meta: meta(node, octoId, opts.includePixsoProvenance === true)
	};
	if (name === "Text") ui.content = node.characters ?? "";
	if (name === "Image" && shouldEmitImageSrc(node)) ui.src = opts.imageSrcMode === "asset-path" ? imageAssetPathForOctoId(octoId) : "placeholder";
	if (children.length > 0) ui.children = children;
	return ui;
}
function exportStage14ArkUiDsl(raw, opts = {}) {
	const root = parseDesignStage14(raw);
	pruneFullyCoveredStackChildrenForArkUi(root);
	return {
		page: {
			name: pageName(opts.sourcePath, root),
			description: opts.sourcePath ?? root.name
		},
		ui: designNodeToArkUiDslNode(root, opts)
	};
}
//#endregion
//#region src/pixso-arkui.ts
function withoutMeta(node) {
	const next = { ...node };
	delete next.meta;
	if (next.children) next.children = next.children.map(withoutMeta);
	return next;
}
/**
* 将 JSON.parse 后的 Pixso 设计稿对象转换为 ArkUI DSL。
* 图片节点只生成 assets/<octoId>.png 引用，不负责下载或打包图片二进制。
*/
function pixsoToArkUiDsl(pixsoData, options = {}) {
	const isRefsInput = isPixsoRefsRoot(pixsoData);
	const isCanonicalInput = !isRefsInput && isRawNewRoot(pixsoData) && pixsoData.content.length > 0;
	if (!isRefsInput && !isPixsoDesignRoot(pixsoData) && !isCanonicalInput) throw new TypeError("pixsoToArkUiDsl: Pixso 输入不是有效的设计稿数据");
	const dsl = exportStage14ArkUiDsl(pixsoData, {
		sourcePath: options.sourcePath,
		imageSrcMode: "asset-path",
		includePixsoProvenance: options.includePixsoProvenance === true
	});
	if (options.pageName !== void 0) dsl.page.name = options.pageName;
	if (options.pageDescription !== void 0) dsl.page.description = options.pageDescription;
	if (options.keepMeta === false) dsl.ui = withoutMeta(dsl.ui);
	return dsl;
}
//#endregion
//#region src/pixso-arkts.ts
var DEFAULT_STRUCT_NAME = "PixsoPage";
var PAGE_STRUCT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*Page$/;
var ARKTS_RESERVED_WORDS = new Set([
	"abstract",
	"accessor",
	"any",
	"as",
	"assert",
	"asserts",
	"async",
	"await",
	"bigint",
	"boolean",
	"break",
	"build",
	"case",
	"catch",
	"class",
	"component",
	"const",
	"constructor",
	"continue",
	"debugger",
	"declare",
	"default",
	"defer",
	"delete",
	"do",
	"else",
	"entry",
	"enum",
	"export",
	"extends",
	"false",
	"finally",
	"for",
	"from",
	"function",
	"get",
	"global",
	"if",
	"implements",
	"import",
	"in",
	"infer",
	"instanceof",
	"interface",
	"intrinsic",
	"is",
	"keyof",
	"let",
	"module",
	"namespace",
	"never",
	"new",
	"null",
	"number",
	"object",
	"of",
	"out",
	"override",
	"package",
	"private",
	"protected",
	"public",
	"readonly",
	"require",
	"return",
	"satisfies",
	"set",
	"static",
	"string",
	"struct",
	"super",
	"switch",
	"symbol",
	"this",
	"throw",
	"true",
	"try",
	"type",
	"typeof",
	"undefined",
	"unique",
	"unknown",
	"using",
	"var",
	"void",
	"while",
	"with",
	"yield"
]);
/**
* 显式生成与历史 Octo mock 同契约的 canonical RawNewRoot。该返回对象也是
* pixsoToArkTs/Stage pipeline 的真实输入，不是从 DesignNode 反向导出的副本。
*/
function pixsoToRawNewRoot(pixsoData, options = {}) {
	if (options === null || typeof options !== "object" || Array.isArray(options)) throw new TypeError("pixsoToRawNewRoot: options 必须是对象");
	if (isPixsoDualDslInput(pixsoData)) return convertPixsoToRawNewRoot(assemblePixsoDualDesignRoot(pixsoData.full, pixsoData.occurrence));
	if (isPixsoRefsRoot(pixsoData)) return convertPixsoRefsToRawNewRoot(pixsoData, options);
	if (isPixsoDesignRoot(pixsoData)) return convertPixsoToRawNewRoot(pixsoData);
	if (isRawNewRoot(pixsoData) && pixsoData.content.length > 0) return pixsoData;
	throw new TypeError("pixsoToRawNewRoot: Pixso 输入不是有效的设计稿数据");
}
function resolveStructName(structName) {
	const resolved = structName === void 0 ? DEFAULT_STRUCT_NAME : structName;
	if (typeof resolved !== "string" || !PAGE_STRUCT_NAME_PATTERN.test(resolved) || ARKTS_RESERVED_WORDS.has(resolved)) throw new TypeError("pixsoToArkTs: structName 必须是以 Page 结尾、合法且非保留字的 ArkTS 标识符");
	return resolved;
}
function pixsoMediaName(imageId) {
	return `pixso_${imageId.replace(/[^A-Za-z0-9_]/g, "_").toLowerCase()}`;
}
function localBackgroundSource(backgroundImage) {
	const urlMatch = backgroundImage.trim().match(/^url\(\s*(['"]?)(.*?)\1\s*\)$/i);
	if (!urlMatch) return void 0;
	const source = urlMatch[2].trim();
	return /^https?:/i.test(source) ? void 0 : source;
}
function registerMedia(imageId, registry) {
	if (!imageId) throw new TypeError("pixsoToArkTs: 本地图片缺少真实 Pixso 节点 ID");
	const mediaName = pixsoMediaName(imageId);
	const existingOwner = registry.mediaOwners.get(mediaName);
	if (existingOwner !== void 0 && existingOwner !== imageId) throw new TypeError(`pixsoToArkTs: Pixso 节点 ID ${existingOwner} 与 ${imageId} 映射到同一 media 名 ${mediaName}`);
	registry.mediaOwners.set(mediaName, imageId);
	if (!registry.imageIds.has(imageId)) {
		registry.imageIds.add(imageId);
		registry.candidates.push({
			imageId,
			mediaName
		});
	}
	return {
		imageId,
		mediaName
	};
}
function normalizeMediaSources(node, registry) {
	let imageComponentId;
	if (node.componentName === "Image" && node.src && !/^https?:/i.test(node.src)) {
		imageComponentId = node.meta?.pixsoImageId ?? node.meta?.pixsoNodeId;
		node.src = `assets/${registerMedia(imageComponentId, registry).mediaName}.png`;
	}
	if (typeof node.styles?.backgroundImage === "string" && localBackgroundSource(node.styles.backgroundImage) !== void 0) {
		const media = registerMedia(imageComponentId ?? node.meta?.pixsoImageId ?? node.meta?.pixsoNodeId, registry);
		node.styles.backgroundImage = `url("assets/${media.mediaName}.png")`;
	}
	node.children?.forEach((child) => normalizeMediaSources(child, registry));
}
function skipQuotedLiteral(source, start, quote) {
	let index = start + 1;
	while (index < source.length) {
		if (source[index] === "\\") {
			index += 2;
			continue;
		}
		if (source[index] === quote) return index + 1;
		index += 1;
	}
	return source.length;
}
function referencedPixsoMedia(code) {
	const media = /* @__PURE__ */ new Set();
	let index = 0;
	while (index < code.length) {
		const current = code[index];
		const next = code[index + 1];
		if (current === "\"" || current === "'" || current === "`") {
			index = skipQuotedLiteral(code, index, current);
			continue;
		}
		if (current === "/" && next === "/") {
			const lineEnd = code.indexOf("\n", index + 2);
			index = lineEnd < 0 ? code.length : lineEnd + 1;
			continue;
		}
		if (current === "/" && next === "*") {
			const commentEnd = code.indexOf("*/", index + 2);
			index = commentEnd < 0 ? code.length : commentEnd + 2;
			continue;
		}
		if (current === "$" && code[index + 1] === "r" && (index === 0 || !/[A-Za-z0-9_$]/.test(code[index - 1]))) {
			const match = code.slice(index).match(/^\$r\(\s*(['"])app\.media\.(pixso_[A-Za-z0-9_]+)\1\s*\)/);
			if (match) {
				media.add(match[2]);
				index += match[0].length;
				continue;
			}
		}
		index += 1;
	}
	return media;
}
function referencedImageIds(code, registry) {
	const referencedMedia = referencedPixsoMedia(code);
	const unknownMedia = [...referencedMedia].filter((name) => !registry.mediaOwners.has(name));
	if (unknownMedia.length > 0) throw new TypeError(`pixsoToArkTs: ArkTS 包含无法映射到 Pixso 节点 ID 的 media：${unknownMedia.join(", ")}`);
	return registry.candidates.filter((candidate) => referencedMedia.has(candidate.mediaName)).map((candidate) => candidate.imageId);
}
/**
* 将 JSON.parse 后的 Pixso 设计对象转换为完整 ArkTS 页面源码和图片导出清单。
* imageIds 可交给 Pixso MCP；导出文件按 pixso_<id>.png 放入 HarmonyOS media 目录。
*/
function pixsoToArkTs(pixsoData, options = {}) {
	if (options === null || typeof options !== "object" || Array.isArray(options)) throw new TypeError("pixsoToArkTs: options 必须是对象");
	if (Object.prototype.hasOwnProperty.call(options, "detectRepetitivePattern")) throw new TypeError("pixsoToArkTs: detectRepetitivePattern 已移除，重复结构由引擎自动优化");
	const structName = resolveStructName(options.structName);
	const dsl = pixsoToArkUiDsl(pixsoToRawNewRoot(pixsoData), {
		pageName: structName,
		includePixsoProvenance: true
	});
	const registry = {
		candidates: [],
		imageIds: /* @__PURE__ */ new Set(),
		mediaOwners: /* @__PURE__ */ new Map()
	};
	normalizeMediaSources(dsl.ui, registry);
	let code;
	try {
		code = generatePartitionedArkUICode(dsl);
		if (typeof code !== "string" || code.trim() === "") throw new TypeError("ArkTS generator 返回了空的源码");
	} catch (cause) {
		throw new Error("pixsoToArkTs: ArkTS 生成失败", { cause });
	}
	return {
		code,
		imageIds: referencedImageIds(code, registry)
	};
}
//#endregion
export { pixsoToArkTs, pixsoToRawNewRoot };
