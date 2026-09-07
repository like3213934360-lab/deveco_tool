// Catalog order and names are the pinned docs search.db contract.
// Upstream: deveco-cli/src/docs/portal/catalog.ts and doc-index/constants.ts.
export const docCatalogNames = [
  "harmonyos-guides",
  "harmonyos-references",
  "best-practices",
  "harmonyos-faqs",
  "harmonyos-releases",
  "harmonyos-roadmap",
] as const;
export type DocCatalog = (typeof docCatalogNames)[number] | "all";
export const docCatalogTitles = [
  "开发指南",
  "API参考",
  "最佳实践",
  "FAQ",
  "版本说明",
  "变更预告",
] as const;
