// 번호로 찾기 — 머리줄 어디서나(사용자 2026-11-27 "실시간 흐름을 파악하기가 너무 어렵다" → 2 "TRF 번호 하나로 다 보기").
// T482913(요청) → TRF 상세(처음부터 끝까지·손볼 것), W4821(묶음) → Wave 상세. 숫자만 넣으면 TRF 로 먼저, 없으면 Wave.
// 서버 목록의 number 거르기로 찾는다(cdc-outbound 0.21.0). 못 찾으면 그대로 알린다(지어내지 않음).
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { useApi } from '../app/ApiContext';
import { trfWavePath, wavePath } from '../features/trf-wave/TrfWavePages';
import { findTrfId, findWaveId } from './findByNumber';
import { messages } from './messages';

const t = messages.search;

export function NumberSearch({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    const isWave = /^W(AVE-)?/i.test(v);
    const isTrf = /^T(RF-)?/i.test(v) || /^\d+$/.test(v);
    if (!isWave && !isTrf) {
      setNote(t.unknown);
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      if (isTrf) {
        const id = await findTrfId(api, cdcId, v);
        if (id) {
          setValue('');
          void navigate(trfWavePath(cdcId, `trf/${encodeURIComponent(id)}`));
          return;
        }
      }
      if (isWave || /^\d+$/.test(v)) {
        const id = await findWaveId(api, cdcId, v);
        if (id) {
          setValue('');
          void navigate(wavePath(cdcId, id));
          return;
        }
      }
      setNote(t.notFound(v));
    } catch {
      setNote(t.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="relative hidden items-center gap-1 md:flex" role="search" aria-label={t.label} onSubmit={(e) => void submit(e)} data-testid="number-search">
      <input
        className="input input-xs w-36 font-mono"
        value={value}
        placeholder={t.placeholder}
        aria-label={t.label}
        onChange={(e) => {
          setValue(e.target.value);
          setNote(null);
        }}
        data-testid="number-search-input"
      />
      <button type="submit" className="btn btn-xs" aria-label={t.label} disabled={busy || !value.trim()} data-testid="number-search-go">
        {t.go}
      </button>
      {note && (
        <span role="status" className="absolute top-full right-0 z-30 mt-1 whitespace-nowrap rounded-box bg-base-100 px-2 py-1 text-xs text-warning shadow" data-testid="number-search-note">
          {note}
        </span>
      )}
    </form>
  );
}
