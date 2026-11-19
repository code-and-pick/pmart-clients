// 콘텐츠 조회(2026-11-19)는 상품으로 합쳤다(같은 날 상품 묶음 합치기 1단계 — 백엔드 백오피스 제안, 사용자 "조회부터").
// 상품 목록의 "콘텐츠" 열·거르기, 상품 상세의 "고객 화면" 탭이 같은 일을 한다. 옛 주소는 그쪽으로 넘긴다.
//   /contents → /products, /contents?view=missing → /products?content=missing, /contents?preview=<상품> → /products/<상품>?tab=content
import { Navigate, useSearchParams } from 'react-router';

export function ContentsRedirect() {
  const [params] = useSearchParams();
  const preview = params.get('preview');
  if (preview) return <Navigate replace to={`/products/${encodeURIComponent(preview)}?tab=content`} />;
  const view = params.get('view');
  return <Navigate replace to={view === 'published' || view === 'missing' ? `/products?content=${view}` : '/products'} />;
}
