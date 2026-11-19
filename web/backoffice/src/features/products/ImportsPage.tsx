// 일괄 등록 한 메뉴(2026-11-19 상품 묶음 합치기 — 백엔드 백오피스 제안, 사용자 "메뉴 정리 먼저"): 상품·콘텐츠·가격 탭.
// 파일 모양이 달라 합치지 않고 탭만 하나로 — 순서(상품 → 콘텐츠 → 가격)를 안내한다. 각 탭은 원래 화면 그대로(주소 ?tab=).
// 옛 주소(/products/import·/contents/import·/prices/import)와 배치 화면은 그대로 열린다(메뉴는 "일괄 등록"이 켜진다).
import { useSearchParams } from 'react-router';

import { NewContentImportPage } from '../contents/ContentImportPage';
import { NewPriceImportPage } from '../prices/PriceImportPage';
import { messages } from '../../shared/messages';
import { UnderlineTabs } from './parts';
import { NewProductImportPage } from './ProductImportPage';

const m = messages.products.imports;
type Tab = 'product' | 'content' | 'price';
const TABS: readonly Tab[] = ['product', 'content', 'price'];

export function ImportsPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.find((t) => t === params.get('tab')) ?? 'product';
  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <h1 className="text-xl font-bold tracking-tight">{m.title}</h1>
        {/* 순서 안내 — 상품이 승인돼 SKU 가 나와야 콘텐츠·가격이 그 상품에 붙는다 */}
        <ol className="flex flex-wrap items-center gap-2 text-sm text-base-content/65" aria-label={m.orderLabel} data-testid="imports-order">
          {TABS.map((t, i) => (
            <li key={t} className="flex items-center gap-2">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-base-200 text-[11px] font-bold">{i + 1}</span>
              {m.tab[t]}
              {i < TABS.length - 1 && <span aria-hidden="true">→</span>}
            </li>
          ))}
          <li className="text-xs text-base-content/50">{m.orderHint}</li>
        </ol>
      </div>
      <UnderlineTabs<Tab> label={m.title} value={tab} onChange={(t) => setParams(t === 'product' ? {} : { tab: t }, { replace: true })} options={TABS.map((t) => ({ value: t, label: m.tab[t] }))} />
      {tab === 'product' && <NewProductImportPage />}
      {tab === 'content' && <NewContentImportPage />}
      {tab === 'price' && <NewPriceImportPage />}
    </section>
  );
}
