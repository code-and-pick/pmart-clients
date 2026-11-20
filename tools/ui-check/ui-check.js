// 직원 웹 화면 점검(2026-11-20 — 백오피스 AWS 개편 때 쓴 검사를 모음). 브라우저 개발자 도구 콘솔에 이 파일 내용을 붙여 넣고:
//   await uiCheck.all()            지금 화면: 글자 겹침·이름표 간격·단추 붙음·화면 밖 넘침·글자 세로 쌓임·대비(어두운 화면이면)
//   await uiCheck.pages(['/a','/b'])  여러 화면을 차례로(같은 탭에서 주소만 바꿈 — 로그인 유지) — 결과는 화면별 목록
//   uiCheck.csp()                  실서버 nginx 와 같은 CSP(style-src 'self')를 이 탭에 걸고, 막힌 것을 uiCheck.blocked 에 모은다
// 좁은 폭은 같은 출처 iframe 으로: uiCheck.narrow(1024, ['/a']) — 창 크기를 바꾸지 않고 1024px 로 본다.
// 읽기만 한다(누르거나 저장하지 않음). 결과가 0 건이어도 눈으로 한 번 더 본다 — 이 검사는 정해 둔 모양만 잡는다.
(() => {
  const vis = (el, W = window) => {
    for (let e = el; e; e = e.parentElement) {
      const s = W.getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
      if (s.clipPath && s.clipPath.includes('inset(50%')) return false;
    }
    return true;
  };
  const clipOf = (el, doc, W) => {
    let c = null;
    for (let e = el; e && e !== doc.body; e = e.parentElement) {
      const s = W.getComputedStyle(e);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible' || s.textOverflow === 'ellipsis' || (s.webkitLineClamp && s.webkitLineClamp !== 'none')) {
        const b = e.getBoundingClientRect();
        c = c ? { left: Math.max(c.left, b.left), right: Math.min(c.right, b.right), top: Math.max(c.top, b.top), bottom: Math.min(c.bottom, b.bottom) } : { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
      }
    }
    return c;
  };
  const cut = (q, c) => (c ? { left: Math.max(q.left, c.left), right: Math.min(q.right, c.right), top: Math.max(q.top, c.top), bottom: Math.min(q.bottom, c.bottom) } : q);
  const SKIP = 'details:not([open]) > :not(summary), [role=tooltip], [role=dialog], [role=menu], [role=listbox], script, style';

  /** 글자·아이콘 상자가 3px 넘게 겹치는 곳 */
  function overlap(doc = document) {
    const W = doc.defaultView;
    const boxes = [];
    const tw = doc.createTreeWalker(doc.querySelector('main') ?? doc.body, W.NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el || !vis(el, W) || el.closest(SKIP)) continue;
      const c = clipOf(el, doc, W);
      const r = doc.createRange();
      r.selectNodeContents(n);
      for (const q of r.getClientRects()) {
        const x = cut(q, c);
        if (x.right - x.left > 1 && x.bottom - x.top > 1) boxes.push({ q: x, el, t: n.textContent.trim().slice(0, 14) });
      }
    }
    const out = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.q.right, b.q.right) - Math.max(a.q.left, b.q.left);
        const h = Math.min(a.q.bottom, b.q.bottom) - Math.max(a.q.top, b.q.top);
        if (w > 3 && h > 3) out.push(`겹침: ${a.t} / ${b.t}`);
      }
    return out;
  }

  /** 이름표와 칸이 같은 줄에 붙음, 이름표-칸 세로 간격 0 또는 너무 큼, 체크 옆 글자 붙음, 단추끼리 붙음 */
  function spacing(doc = document) {
    const W = doc.defaultView;
    const out = [];
    const textRect = (lab, ctl) => {
      for (const n of lab.childNodes) {
        if (n.nodeType === 3 && n.textContent.trim()) {
          const r = doc.createRange();
          r.selectNodeContents(n);
          const b = r.getBoundingClientRect();
          if (b.width) return b;
        } else if (n.nodeType === 1 && n !== ctl && !n.contains(ctl) && n.textContent.trim() && !['SELECT', 'INPUT', 'TEXTAREA'].includes(n.tagName)) {
          const b = n.getBoundingClientRect();
          if (b.width) return b;
        }
      }
      return null;
    };
    for (const lab of doc.querySelectorAll('main label')) {
      const ctl = lab.querySelector('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea');
      if (ctl && vis(ctl, W)) {
        const cr = ctl.getBoundingClientRect();
        const tr = textRect(lab, ctl);
        if (tr) {
          const same = Math.min(tr.bottom, cr.bottom) - Math.max(tr.top, cr.top) > 4;
          // 칸 왼쪽 글자(이름표)만 — 칸 오른쪽의 안내 글("비우면 오늘")은 이름표가 아니다
          if (same && tr.right <= cr.left + 2 && cr.left - tr.right < 6) out.push(`이름표 옆 붙음: ${lab.textContent.trim().slice(0, 12)}`);
          else if (!same && tr.bottom <= cr.top + 2 && (cr.top - tr.bottom < 1 || cr.top - tr.bottom > 14)) out.push(`이름표-칸 세로 ${Math.round(cr.top - tr.bottom)}px: ${lab.textContent.trim().slice(0, 12)}`);
        }
      }
      const box = lab.querySelector('input[type=checkbox], input[type=radio]');
      if (box && vis(box, W)) {
        const br = box.getBoundingClientRect();
        const tr = textRect(lab, box);
        if (tr && Math.min(tr.bottom, br.bottom) - Math.max(tr.top, br.top) > 2 && tr.left > br.left && tr.left - br.right < 3) out.push(`체크 옆 글자 붙음: ${lab.textContent.trim().slice(0, 12)}`);
      }
    }
    // 고르기 칸 안 글자가 위로 붙음(select 에 block 등으로 가운데 맞춤이 깨짐)
    for (const sel of doc.querySelectorAll('main select.select')) if (vis(sel, W) && !W.getComputedStyle(sel).display.includes('flex')) out.push(`고르기 칸 가운데 맞춤 깨짐: ${sel.closest('label')?.textContent.trim().slice(0, 12) ?? sel.name}`);
    const btns = [...doc.querySelectorAll('main button, main a.btn')].filter((b) => vis(b, W) && !b.closest('.join, [role=radiogroup], [role=tablist], nav[aria-label="쪽"], .pm-stat-strip, table'));
    for (let i = 0; i < btns.length; i++)
      for (let j = i + 1; j < btns.length; j++) {
        if (btns[i].parentElement !== btns[j].parentElement) continue;
        const a = btns[i].getBoundingClientRect(), b = btns[j].getBoundingClientRect();
        if (Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) < a.height / 2) continue;
        const g = a.right <= b.left ? b.left - a.right : b.right <= a.left ? a.left - b.right : -1;
        if (g >= 0 && g < 4) out.push(`단추 붙음: ${btns[i].textContent.trim().slice(0, 8)} | ${btns[j].textContent.trim().slice(0, 8)}`);
      }
    return out;
  }

  /** 화면 밖으로 나감·가로 스크롤·한 글자씩 세로로 쌓임 */
  function overflow(doc = document) {
    const W = doc.defaultView;
    const out = [];
    const vw = doc.documentElement.clientWidth;
    if (doc.documentElement.scrollWidth > vw + 2) out.push(`가로 스크롤 ${doc.documentElement.scrollWidth}>${vw}`);
    for (const el of doc.querySelectorAll('main *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || r.right <= vw + 2) continue;
      let clipped = false;
      for (let e = el.parentElement; e && e !== doc.body; e = e.parentElement) if (W.getComputedStyle(e).overflowX !== 'visible') { clipped = true; break; }
      if (!clipped) out.push(`밖으로 나감: ${el.textContent.trim().slice(0, 14) || el.tagName}`);
    }
    for (const el of doc.querySelectorAll('main span, main a, main p')) {
      const t = el.textContent.trim();
      if (t.length < 2 || t.length > 8 || el.children.length) continue;
      const r = el.getBoundingClientRect();
      const lh = parseFloat(W.getComputedStyle(el).lineHeight) || 16;
      if (r.height > lh * 2.2 && r.width < 30) out.push(`글자 세로로 쌓임: ${t}`);
    }
    return out;
  }

  /** 글자 대비 2.6 미만(흐린 0·화살표 등) — 어두운 화면에서 특히 */
  function contrast(doc = document) {
    const W = doc.defaultView;
    const cv = doc.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const rgba = (c) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const mix = (t, b) => [0, 1, 2].map((i) => t[i] * t[3] + b[i] * (1 - t[3])).concat(1);
    const base = rgba(W.getComputedStyle(doc.body).backgroundColor);
    const bgOf = (el) => { const L = []; for (let e = el; e; e = e.parentElement) { const c = rgba(W.getComputedStyle(e).backgroundColor); if (c[3] > 0) { L.push(c); if (c[3] >= 0.99) break; } } let b = base[3] ? base : [255, 255, 255, 1]; for (let i = L.length - 1; i >= 0; i--) b = mix(L[i], b); return b; };
    const out = [];
    const tw = doc.createTreeWalker(doc.querySelector('main') ?? doc.body, W.NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) {
      const t = n.textContent.trim();
      const el = n.parentElement;
      if (!t || !el || !vis(el, W) || el.closest('[aria-hidden=true], :disabled, .btn-disabled, [role=tooltip]')) continue;
      let op = 1;
      for (let e = el; e; e = e.parentElement) op *= Number(W.getComputedStyle(e).opacity);
      const bg = bgOf(el);
      const c0 = rgba(W.getComputedStyle(el).color);
      const fg = mix([c0[0], c0[1], c0[2], c0[3] * op], bg);
      const A = lum(fg), B = lum(bg);
      const ratio = (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05);
      if (ratio < 2.6) out.push(`대비 ${ratio.toFixed(1)}: ${t.slice(0, 14)}`);
    }
    return [...new Set(out)];
  }

  const uniq = (a) => [...new Set(a)];
  async function all(doc = document) {
    // 접힌 <details> 는 열지 않는다 — 출처 꼬리표처럼 펼치면 본문 위에 뜨는 것이 있어 겹침으로 잘못 잡힌다(접힌 안쪽은 SKIP 이 건너뛴다)
    await new Promise((r) => setTimeout(r, 150));
    return uniq([...overlap(doc), ...spacing(doc), ...overflow(doc), ...(doc.documentElement.getAttribute('data-theme')?.includes('dark') ? contrast(doc) : [])]);
  }
  async function pages(paths, win = window, wait = 1500) {
    const res = {};
    for (const p of paths) {
      win.history.pushState({}, '', p);
      win.dispatchEvent(new PopStateEvent('popstate'));
      await new Promise((r) => setTimeout(r, wait));
      const h = await all(win.document);
      if (h.length) res[p.replace(/[?&=]/g, ' ')] = h.slice(0, 10);
    }
    return res;
  }
  /** 같은 출처 iframe(폭 w) 안에서 pages — 로그인은 iframe 안에서 다시 해야 할 수 있다(메모리 세션) */
  async function narrow(w, paths) {
    document.getElementById('ui-check-frame')?.remove();
    const f = document.createElement('iframe');
    f.id = 'ui-check-frame';
    f.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:900px;z-index:99999;background:#fff;border:2px solid red`;
    f.src = location.pathname;
    document.body.appendChild(f);
    await new Promise((r) => { f.onload = r; });
    await new Promise((r) => setTimeout(r, 1500));
    return pages(paths, f.contentWindow);
  }
  const blocked = [];
  function csp(policy = "style-src 'self'") {
    const meta = document.createElement('meta');
    meta.httpEquiv = 'Content-Security-Policy';
    meta.content = policy;
    document.head.appendChild(meta);
    document.addEventListener('securitypolicyviolation', (e) => blocked.push(`${e.violatedDirective}: ${e.blockedURI || e.sample || ''}`));
    return '이 탭에 CSP 를 걸었어요 — 화면을 써 본 뒤 uiCheck.blocked 를 보세요';
  }
  window.uiCheck = { all, pages, narrow, csp, blocked, overlap, spacing, overflow, contrast };
  return 'uiCheck 준비됨 — await uiCheck.all()';
})();
