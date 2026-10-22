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
