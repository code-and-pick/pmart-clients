// 카카오 지도 위 라이더 현재 위치(관제). 키(VITE_KAKAO_JS_KEY)가 있을 때만 SDK 를 불러온다 — 키는 로그·화면에 남기지 않는다.
// 키가 없거나 SDK 를 못 불러오면 안내만 하고 표(ControlPage)로 본다. 이동 이력·경로는 그리지 않는다(현재 위치만 — ADR-0068).
import { useEffect, useRef, useState } from 'react';

const m = {
  map: {
    noKey: '카카오 지도 키가 없어 표로만 보여요. 키는 PC 1 설정(VITE_KAKAO_JS_KEY)이고, 카카오 개발자 콘솔에 이 주소를 웹 도메인으로 등록해야 해요.',
    failed: '카카오 지도를 불러오지 못해 표로만 보여요.',
    label: '라이더 위치 지도',
    center: '픽업 센터',
  },
} as const;

export interface MapRider {
  readonly riderId: string;
  readonly lat: number;
  readonly lng: number;
  readonly tone: 'ok' | 'stale' | 'delivering';
  readonly label: string;
}

interface KakaoNs {
  readonly maps: {
    load(cb: () => void): void;
    LatLng: new (lat: number, lng: number) => unknown;
    Map: new (el: HTMLElement, opts: { center: unknown; level: number }) => { setCenter(p: unknown): void };
    CustomOverlay: new (opts: { position: unknown; content: HTMLElement; yAnchor?: number }) => { setMap(m: unknown): void };
  };
}

declare global {
  interface Window {
    kakao?: KakaoNs;
  }
}

const KEY = import.meta.env.VITE_KAKAO_JS_KEY;
let sdk: Promise<KakaoNs> | null = null;

function loadSdk(key: string): Promise<KakaoNs> {
  sdk ??= new Promise<KakaoNs>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
    s.async = true;
    s.onload = () => {
      const k = window.kakao;
      if (!k) reject(new Error('kakao'));
      else k.maps.load(() => resolve(k));
    };
    s.onerror = () => {
      sdk = null;
      reject(new Error('kakao'));
    };
    document.head.appendChild(s);
  });
  return sdk;
}

const toneClass: Record<MapRider['tone'], string> = { ok: 'badge-success', delivering: 'badge-info', stale: 'badge-warning' };

export function KakaoRiderMap({
  center,
  riders,
  onSelect,
  selectedId = '',
}: {
  readonly center: { readonly lat: number; readonly lng: number } | null;
  readonly riders: readonly MapRider[];
  readonly onSelect: (riderId: string) => void;
  /** 고른 라이더 — 크게 표시하고 그 위치로 지도를 옮긴다(고를 때 한 번) */
  readonly selectedId?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>(KEY ? 'loading' : 'failed');
  const [kakao, setKakao] = useState<KakaoNs | null>(null);
  const mapRef = useRef<{ setCenter(p: unknown): void } | null>(null);

  useEffect(() => {
    if (!KEY) return;
    let alive = true;
    loadSdk(KEY).then(
      (k) => {
        if (alive) {
          setKakao(k);
          setState('ready');
        }
      },
      () => alive && setState('failed'),
    );
    return () => {
      alive = false;
    };
  }, []);

  // 지도는 한 번 만들고, 센터가 바뀌면 가운데만 옮긴다.
  useEffect(() => {
    if (!kakao || !el.current) return;
    const first = center ?? riders[0] ?? { lat: 35.1577, lng: 129.0594 };
    const pos = new kakao.maps.LatLng(first.lat, first.lng);
    if (!mapRef.current) mapRef.current = new kakao.maps.Map(el.current, { center: pos, level: 5 });
    else if (center) mapRef.current.setCenter(pos);
  }, [kakao, center, riders]);

  // 라이더 표시(10초마다 새 목록 → 다시 그린다).
  useEffect(() => {
    const map = mapRef.current;
    if (!kakao || !map) return;
    const overlays = riders.map((r) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `badge ${toneClass[r.tone]} cursor-pointer shadow ${r.riderId === selectedId ? 'badge-md ring-2 ring-primary ring-offset-1 font-bold' : 'badge-sm'}`;
      dot.setAttribute('aria-pressed', String(r.riderId === selectedId));
      dot.textContent = r.label;
      dot.onclick = () => onSelect(r.riderId);
      const o = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(r.lat, r.lng), content: dot, yAnchor: 1 });
      o.setMap(map);
      return o;
    });
    const centerMark = (() => {
      if (!center) return null;
      const box = document.createElement('span');
      box.className = 'badge badge-neutral badge-sm';
      box.textContent = m.map.center;
      const o = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(center.lat, center.lng), content: box, yAnchor: 1 });
      o.setMap(map);
      return o;
    })();
    return () => {
      for (const o of overlays) o.setMap(null);
      centerMark?.setMap(null);
    };
  }, [kakao, riders, center, onSelect, selectedId]);

  // 라이더를 고르면 그 위치로 한 번 옮긴다(10초마다 새 목록이 와도 다시 옮기지 않는다 — 운영자가 끌어 둔 곳을 지킨다).
  const focused = useRef('');
  useEffect(() => {
    const map = mapRef.current;
    if (!kakao || !map || !selectedId || focused.current === selectedId) return;
    const r = riders.find((x) => x.riderId === selectedId);
    if (!r) return;
    focused.current = selectedId;
    map.setCenter(new kakao.maps.LatLng(r.lat, r.lng));
  }, [kakao, riders, selectedId]);

  if (state === 'failed') {
    return (
      <p role="note" className="rounded-box bg-base-300/50 px-4 py-3 text-sm text-base-content/75" data-testid="map-unavailable">
        {KEY ? m.map.failed : m.map.noKey}
      </p>
    );
  }
  return <div ref={el} aria-label={m.map.label} className="h-96 w-full rounded-box border border-base-300 bg-base-200" data-testid="rider-map" />;
}
