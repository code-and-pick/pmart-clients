// 넓은 표 표시(2026-11-21) — console.css 의 "긴 표 머리 고정"은 1280px 이상에서 표 감싸개(.overflow-x-auto)의 가로 스크롤을 풀어
// 머리 칸을 화면 위에 붙인다. 그런데 칸보다 넓은 표는 그러면 옆 칸 위로 넘쳐 그려지거나(두 칸 상세 — PC 5 라이더 상세 배정 이력, 통합 주문 상세)
// 바깥 상자에 잘려 뒤 칸을 볼 수 없었다(통합 접수 건 목록 9칸). CSS 로는 "넘치는지"를 알 수 없어, 넘치는 감싸개에만
// data-table-wide 를 달아 그 표는 예전처럼 가로 스크롤로 둔다. 들어맞는 표는 지금처럼 머리 고정.

const WRAP = '.overflow-x-auto';
export const TABLE_WIDE_ATTR = 'data-table-wide';

/** 감싸개 안 표가 감싸개보다 넓으면 표시를 단다. 표 폭은 감싸개의 overflow 와 상관없이 같아 어느 쪽 상태에서 재도 된다. */
export function markTableFit(wrap: HTMLElement): void {
  const table = wrap.querySelector<HTMLElement>(':scope > table');
  if (!table) return;
  const wide = table.offsetWidth > wrap.clientWidth + 1;
  if (wide) wrap.setAttribute(TABLE_WIDE_ATTR, '');
  else wrap.removeAttribute(TABLE_WIDE_ATTR);
}

/** 문서 안 모든 표 감싸개를 지켜본다(새로 그려진 것·폭이 바뀐 것). 반환값으로 멈춘다. ResizeObserver 가 없으면(시험 환경) 아무것도 안 한다. */
export function watchTableFit(root: ParentNode & Node = document.body): () => void {
  if (typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
  const owner = new WeakMap<Element, HTMLElement>(); // 지켜보는 요소(감싸개·표) → 감싸개
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      const wrap = owner.get(e.target);
      if (wrap) markTableFit(wrap);
    }
  });
  const scan = () => {
    for (const table of root.querySelectorAll<HTMLElement>(`${WRAP} > table`)) {
      if (owner.has(table)) continue;
      const wrap = table.parentElement!;
      owner.set(table, wrap);
      owner.set(wrap, wrap);
      ro.observe(table); // 내용이 바뀌어 표가 넓어지는 것
      ro.observe(wrap); // 화면 폭이 바뀌어 감싸개가 좁아지는 것
    }
  };
  let queued = false;
  const mo = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      scan();
    });
  });
  scan();
  mo.observe(root, { childList: true, subtree: true });
  return () => {
    mo.disconnect();
    ro.disconnect();
  };
}
