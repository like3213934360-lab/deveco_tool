# Object Literal Interface Errors

对象字面量必须对应明确的类或接口。嵌套结构也使用命名接口；不要用 `any` 或匿名对象类型绕过检查。

```typescript
interface ArticleMetadata {
  author: string;
  date: string;
}
interface Article {
  id: string;
  title: string;
  metadata?: ArticleMetadata;
}
interface ArticleResponse {
  success: boolean;
  data: Article[];
  message?: string;
}
const response: ArticleResponse = {
  success: true,
  data: [{ id: 'one', title: '文章', metadata: { author: '作者', date: '2026-01-01' } }]
};

@Entry
@Component
struct ArticlePage {
  private articles: Article[] = response.data;
  build() {
    Column() {
      ForEach(this.articles, (article: Article) => {
        Text(article.title)
      }, (article: Article) => article.id)
    }
  }
}
```

入口组件使用符合 ArkUI 规则的根容器，不能把 `ForEach` 本身当作入口根组件。

[示例](deveco://knowledge/arkts-error-fixes/examples/ObjectLiteralInterfaceError)
