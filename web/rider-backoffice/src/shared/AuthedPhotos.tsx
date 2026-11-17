// 토큰이 필요한 사진 보기(공통) — 도움요청·전달 완료 증빙(execution evidence-photos), 라이더 문의 사진(case inquiry-photos).
// <img src> 로 바로 못 쓴다: 토큰을 붙여 받아 blob → object URL, 화면을 떠나면 해제(서버가 no-store — 캐시에 두지 않는다).
// 못 받은 사진(404·503)은 빈칸·성공이 아니라 "불러오지 못함" + 다시 받기. 사진 내용·URL 은 로그에 남기지 않는다.
import { useEffect, useState } from 'react';

export const photoMessages = {
  title: (label: string, n: number) => `${label} ${n}장`,
  none: '사진이 없어요.',
  unavailable: '사진을 불러오지 못했어요',
  retry: '다시 불러오기',
  alt: (label: string, i: number) => `${label} ${i}`,
  open: (label: string, i: number) => `${label} ${i} 크게 보기`,
  close: '작게',
} as const;

const m = photoMessages;

export type PhotoLoader = (ref: string) => Promise<Blob>;

type Loaded = { readonly kind: 'loading' } | { readonly kind: 'ready'; readonly url: string } | { readonly kind: 'error' };

function usePhotoUrl(load: PhotoLoader, photoRef: string): readonly [Loaded, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ readonly attempt: number; readonly loaded: Loaded } | null>(null);
  useEffect(() => {
    let url: string | undefined;
    let alive = true;
    load(photoRef).then(
      (blob) => {
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setResult({ attempt, loaded: { kind: 'ready', url } });
      },
      () => {
        if (alive) setResult({ attempt, loaded: { kind: 'error' } });
      },
    );
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [load, photoRef, attempt]);
  const state: Loaded = result?.attempt === attempt ? result.loaded : { kind: 'loading' };
  return [state, () => setAttempt((n) => n + 1)] as const;
}

function Photo({ load, photoRef, index, label }: { readonly load: PhotoLoader; readonly photoRef: string; readonly index: number; readonly label: string }) {
  const [state, retry] = usePhotoUrl(load, photoRef);
  const [big, setBig] = useState(false);
  if (state.kind === 'loading') return <span className="loading loading-spinner loading-sm" />;
  if (state.kind === 'error')
    return (
      <span className="flex flex-col items-start gap-1 text-xs text-error" data-testid="photo-error">
        {m.unavailable}
        <button type="button" className="btn btn-ghost btn-xs" onClick={retry}>
          {m.retry}
        </button>
      </span>
    );
  if (big)
    return (
      <figure className="space-y-2 rounded-box bg-base-200 p-3" data-testid="photo-large">
        <img src={state.url} alt={m.alt(label, index + 1)} className="max-h-[70vh] max-w-full object-contain" />
        <figcaption className="flex items-center gap-2 text-xs opacity-70">
          {m.alt(label, index + 1)}
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setBig(false)}>
            {m.close}
          </button>
        </figcaption>
      </figure>
    );
  return (
    <button type="button" className="rounded-box border border-base-300" aria-label={m.open(label, index + 1)} onClick={() => setBig(true)}>
      <img src={state.url} alt={m.alt(label, index + 1)} className="h-24 w-24 rounded-box object-cover" />
    </button>
  );
}

/** 사진 줄. `load` 는 useCallback 등으로 고정해서 넘긴다(바뀌면 다시 받는다). */
export function AuthedPhotos({ refs, load, label, heading = true }: { readonly refs: readonly string[]; readonly load: PhotoLoader; readonly label: string; readonly heading?: boolean }) {
  return (
    <section className="space-y-2" aria-label={m.title(label, refs.length)}>
      {heading && <h2 className="font-bold">{m.title(label, refs.length)}</h2>}
      {refs.length === 0 ? (
        <p className="text-sm opacity-70">{m.none}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {refs.map((ref, i) => (
            <li key={ref} data-testid="photo">
              <Photo load={load} photoRef={ref} index={i} label={label} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
