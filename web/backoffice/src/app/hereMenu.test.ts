import { hereMenu, navGroups } from './nav';

const items = navGroups.flatMap((g) => g.items);

describe('hereMenu — 지금 주소에서 켤 메뉴', () => {
  it('상세 화면은 그 목록 메뉴를 켠다(주문 조회 → 주문 상세)', () => {
    expect(hereMenu(items, '/orders')).toBe('/orders');
    expect(hereMenu(items, '/orders/ORD-MOCK-1005')).toBe('/orders');
  });
  it('가장 길게 맞는 주소 하나만 — 상품 등록 화면은 "상품 관리"가 아니라 "상품 등록", 가격 일괄은 "일괄 등록"', () => {
    expect(hereMenu(items, '/products/drafts/new')).toBe('/products/drafts/new');
    expect(hereMenu(items, '/products/P-1')).toBe('/products');
    expect(hereMenu(items, '/prices/import/J-1')).toBe('/imports');
    expect(hereMenu(items, '/prices')).toBe('/products');
  });
  it('어느 메뉴에도 없는 주소는 없음', () => {
    expect(hereMenu(items, '/nowhere')).toBeNull();
  });
});
