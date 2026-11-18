// 콘텐츠 이미지 고르기(Eum 백오피스 상품 폼 참고). 역할별 영역: 대표(1장) · 상세설명(여러 장, 순서) · 상세정보 표.
// 고른 파일은 미리보기와 함께 목록에 두고(제거 가능), 올리는 시점은 부모가 정한다:
//  - 새 초안: "만들기" 뒤 초안 ID 가 생기면 차례로 올린다(계약상 이미지는 초안에 붙는다).
//  - 기존 초안: 고르는 즉시 올린다.
import { useEffect, useRef, useState } from 'react';

import { IMAGE_ROLES, type ContentImage, type ImageRole } from '../../api/models';
import { messages as m } from '../../shared/messages';
import { AuthedImage } from './AuthedImage';
import { DEFAULT_SLICE_HEIGHT, SLICE_HEIGHTS, sliceImage, type SliceResult } from './sliceImage';

export interface PendingImage {
  readonly id: string;
  readonly file: File;
  readonly role: ImageRole;
  /** 미리보기 URL(jsdom 처럼 못 만들면 빈 문자열) */
  readonly preview: string;
}

const ACCEPT = 'image/jpeg,image/png,image/webp';
let seq = 0;

// 미리보기는 있으면 좋은 것이다. 못 만들어도(jsdom 등) 파일 선택은 그대로 된다.
const objectUrl = (file: File) => {
  try {
    return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '';
  } catch {
    return '';
  }
};
const revoke = (url: string) => {
  if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
};

export function toPending(files: Iterable<File>, role: ImageRole): PendingImage[] {
  return [...files].map((file) => ({ id: `pending-${++seq}`, file, role, preview: objectUrl(file) }));
}

export function ImagePicker({
  pending,
  onChange,
  existing = [],
  disabled = false,
  slicer = sliceImage,
}: {
  readonly pending: readonly PendingImage[];
  readonly onChange: (next: readonly PendingImage[]) => void;
  /** 이미 올라간 이미지(기존 초안). 역할별로 함께 보인다. */
  readonly existing?: readonly ContentImage[];
  readonly disabled?: boolean;
  /** 긴 이미지 자르기(시험에서 바꿔 끼운다 — jsdom 엔 canvas 가 없다) */
  readonly slicer?: (file: File, pieceHeight: number) => Promise<SliceResult>;
}) {
  // 화면을 떠나면 미리보기 URL 을 놓아 준다.
  const latest = useRef<readonly PendingImage[]>([]);
  useEffect(() => {
    latest.current = pending;
  }, [pending]);
  useEffect(() => () => latest.current.forEach((p) => revoke(p.preview)), []);

  const add = (files: FileList | null, role: ImageRole) => {
    if (!files || files.length === 0) return;
    const added = toPending(files, role);
    if (role === 'MAIN') {
      // 대표는 1장. 이미 고른 대표는 새것으로 바꾼다.
      pending.filter((p) => p.role === 'MAIN').forEach((p) => revoke(p.preview));
      onChange([...pending.filter((p) => p.role !== 'MAIN'), added[0]!]);
      return;
    }
    onChange([...pending, ...added]);
  };
  // 긴 상세 이미지 → 상세설명 조각들(고른 순서 뒤에 이어 붙는다 — 올릴 때 sortOrder 가 차례로 매겨진다)
  const latestPending = useRef(pending);
  useEffect(() => {
    latestPending.current = pending;
  }, [pending]);
  /**
   * 잘라 넣기. replaceIds 가 있으면(조각 높이를 바꿔 다시 자를 때 — 2026-11-18 사용자 "높이를 바꾸면 바로 적용이 안 된다")
   * 그 조각들을 같은 자리에서 새 조각으로 바꾼다. 남은 게 하나도 없으면(사용자가 다 지움) 다시 넣지 않는다.
   * 반환: 결과와 이번에 넣은 조각 id(다음 다시 자르기에 쓴다), 넣지 않았으면 null.
   */
  const sliceAndAdd = async (file: File, pieceHeight: number, replaceIds?: readonly string[]): Promise<{ readonly result: SliceResult; readonly ids: readonly string[] } | null> => {
    const r = await slicer(file, pieceHeight);
    const cur = latestPending.current;
    const added = toPending(r.pieces, 'DESCRIPTION');
    if (replaceIds) {
      const at = cur.findIndex((p) => replaceIds.includes(p.id));
      if (at < 0) {
        added.forEach((p) => revoke(p.preview));
        return null;
      }
      cur.filter((p) => replaceIds.includes(p.id)).forEach((p) => revoke(p.preview));
      const rest = cur.filter((p) => !replaceIds.includes(p.id));
      const insertAt = cur.slice(0, at).filter((p) => !replaceIds.includes(p.id)).length;
      onChange([...rest.slice(0, insertAt), ...added, ...rest.slice(insertAt)]);
    } else {
      onChange([...cur, ...added]);
    }
    return { result: r, ids: added.map((p) => p.id) };
  };
  const remove = (id: string) => {
    pending.filter((p) => p.id === id).forEach((p) => revoke(p.preview));
    onChange(pending.filter((p) => p.id !== id));
  };

  return (
    // 놓인 칸 폭에 맞춰(좁은 오른쪽 열이면 한 줄씩, 넓으면 세 칸) — 화면 폭이 아니라 칸 폭 기준(2026-11-18)
    <div className="@container">
    <div className="grid gap-3 @xl:grid-cols-2 @3xl:grid-cols-3">
      {IMAGE_ROLES.map((role) => (
        <RoleSection
          key={role}
          role={role}
          existing={existing.filter((i) => i.role === role).sort((a, b) => a.sortOrder - b.sortOrder)}
          pending={pending.filter((p) => p.role === role)}
          disabled={disabled}
          onAdd={(files) => add(files, role)}
          onRemove={remove}
          {...(role === 'DESCRIPTION' ? { onSlice: sliceAndAdd } : {})}
        />
      ))}
    </div>
    </div>
  );
}

function RoleSection({
  role,
  existing,
  pending,
  disabled,
  onAdd,
  onRemove,
  onSlice,
}: {
  readonly role: ImageRole;
  readonly existing: readonly ContentImage[];
  readonly pending: readonly PendingImage[];
  readonly disabled: boolean;
  readonly onAdd: (files: FileList | null) => void;
  readonly onRemove: (id: string) => void;
  readonly onSlice?: (file: File, pieceHeight: number, replaceIds?: readonly string[]) => Promise<{ readonly result: SliceResult; readonly ids: readonly string[] } | null>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const label = m.contents.imageRole[role];
  const hint = m.contents.imageRoleHint[role];
  const addLabel = m.contents.addImage(label);
  const empty = existing.length === 0 && pending.length === 0;
  const open = () => {
    if (!disabled) input.current?.click();
  };

  return (
    <section className="space-y-2 rounded-box border border-base-300 p-3" aria-label={label}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold">{label}</h3>
          <p className="text-xs opacity-70">{hint}</p>
        </div>
        <button type="button" className="btn btn-outline btn-xs" disabled={disabled} onClick={open}>
          {m.contents.addImageButton}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple={role !== 'MAIN'}
        aria-label={addLabel}
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          onAdd(e.target.files);
          e.target.value = '';
        }}
      />
      {onSlice && <SliceBox disabled={disabled} onSlice={onSlice} />}
      {empty ? (
        <button
          type="button"
          className="flex w-full flex-col items-center justify-center gap-1 rounded-box border-2 border-dashed border-base-300 py-6 text-xs opacity-70 hover:border-base-content"
          disabled={disabled}
          onClick={open}
        >
          <span aria-hidden="true" className="text-2xl">
            🖼
          </span>
          {m.contents.imageEmpty}
        </button>
      ) : (
        <ul className="grid grid-cols-3 gap-2" aria-label={m.contents.imageListOf(label)}>
          {existing.map((img) => (
            <li key={img.imageId} className="relative aspect-square overflow-hidden rounded-box border border-base-300 bg-base-200">
              <AuthedImage imageId={img.imageId} alt={`${label} ${img.sortOrder}`} className="h-full w-full object-contain" />
              <span className="badge badge-neutral badge-xs absolute top-1 left-1">{img.sortOrder}</span>
            </li>
          ))}
          {pending.map((p, i) => (
            <li
              key={p.id}
              className="relative aspect-square overflow-hidden rounded-box border border-dashed border-primary bg-base-200"
              aria-label={m.contents.pendingImage(p.file.name)}
            >
              {p.preview ? (
                <img src={p.preview} alt={p.file.name} className="h-full w-full object-contain" />
              ) : (
                <span className="flex h-full items-center justify-center p-1 text-center text-[10px] break-all">{p.file.name}</span>
              )}
              <span className="badge badge-primary badge-xs absolute top-1 left-1">{existing.length + i}</span>
              <button
                type="button"
                className="btn btn-circle btn-xs absolute top-1 right-1"
                aria-label={m.contents.removeImage(p.file.name)}
                title={m.contents.removeImage(p.file.name)}
                disabled={disabled}
                onClick={() => onRemove(p.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 긴 상세 이미지 잘라 넣기 — 조각 높이를 고르고 파일 한 장을 고르면 바로 잘라 목록 끝에 붙인다 */
function SliceBox({ disabled, onSlice }: { readonly disabled: boolean; readonly onSlice: (file: File, pieceHeight: number, replaceIds?: readonly string[]) => Promise<{ readonly result: SliceResult; readonly ids: readonly string[] } | null> }) {
  const input = useRef<HTMLInputElement>(null);
  const [pieceHeight, setPieceHeight] = useState<number>(DEFAULT_SLICE_HEIGHT);
  const [status, setStatus] = useState<{ readonly kind: 'idle' } | { readonly kind: 'working'; readonly name: string } | { readonly kind: 'done'; readonly text: string } | { readonly kind: 'failed' }>({ kind: 'idle' });
  // 마지막으로 자른 원본과 그때 넣은 조각 — 조각 높이를 바꾸면 이 조각들을 새 높이로 바로 다시 자른다
  const last = useRef<{ file: File; ids: readonly string[] } | null>(null);
  const run = async (file: File | undefined, height: number, replace: boolean) => {
    if (!file) return;
    setStatus({ kind: 'working', name: file.name });
    try {
      const out = await onSlice(file, height, replace ? last.current?.ids : undefined);
      if (!out) {
        // 사용자가 그 조각을 다 지웠다 — 다시 넣지 않고, 다음 높이 바꿈도 하지 않는다
        last.current = null;
        setStatus({ kind: 'idle' });
        return;
      }
      last.current = { file, ids: out.ids };
      const r = out.result;
      setStatus({ kind: 'done', text: r.pieces.length > 1 ? m.contents.slice.done(r.pieces.length, r.width, r.height) : m.contents.slice.single(r.height) });
    } catch {
      setStatus({ kind: 'failed' });
    }
  };
  const changeHeight = (h: number) => {
    setPieceHeight(h);
    if (last.current) void run(last.current.file, h, true);
  };
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-2.5" data-testid="slice-box">
      <p className="text-xs text-base-content/65">{m.contents.slice.hint}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs">
          {m.contents.slice.height}
          <select className="select select-xs w-24" value={pieceHeight} disabled={disabled} onChange={(e) => changeHeight(Number(e.target.value))} aria-label={m.contents.slice.height}>
            {SLICE_HEIGHTS.map((h) => (
              <option key={h} value={h}>
                {m.contents.slice.heightOption(h)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-primary btn-xs" disabled={disabled || status.kind === 'working'} onClick={() => input.current?.click()}>
          {m.contents.slice.button}
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          aria-label={m.contents.slice.file}
          className="hidden"
          disabled={disabled}
          onChange={(e) => {
            void run(e.target.files?.[0], pieceHeight, false);
            e.target.value = '';
          }}
        />
      </div>
      {status.kind === 'working' && (
        <p role="status" className="text-xs text-base-content/60">
          {m.contents.slice.working(status.name)}
        </p>
      )}
      {status.kind === 'done' && (
        <p role="status" className="text-xs text-success" data-testid="slice-done">
          {status.text}
        </p>
      )}
      {status.kind === 'failed' && (
        <p role="alert" className="text-xs text-error">
          {m.contents.slice.failed}
        </p>
      )}
    </div>
  );
}
