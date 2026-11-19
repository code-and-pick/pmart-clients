// 센터 고르기(center-master `GET /centers`). 소속 센터 한 곳, 요청 권한의 센터 여러 곳.
// HR_ADMIN 이 센터 목록을 볼 수 있는지 계약에 없다(회신 Q2) — 못 불러오면 빈 목록으로 보이지 않고, 안내와 함께 코드를 직접 입력받는다.
import { SearchSelect } from '../../shared/SearchSelect';
import { useQuery } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { MultiSelectDropdown } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { messages as m } from '../../shared/messages';

export interface CenterOption {
  readonly value: string;
  readonly label: string;
}

const PAGE_SIZE = 200; // 계약 PageSize 최댓값

export function useCenters() {
  const api = useApi();
  return useQuery({
    queryKey: ['centers'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const page = await request('GET', api.center.GET('/centers', { params: { query: { size: PAGE_SIZE } } }));
      const options: CenterOption[] = (page.items ?? []).flatMap((c) =>
        c.centerId ? [{ value: c.centerId, label: c.name ? `${c.centerId} · ${c.name}` : c.centerId }] : [],
      );
      return { options, more: Boolean(page.page?.nextCursor) };
    },
  });
}

type Centers = ReturnType<typeof useCenters>;

function LoadNote({ centers }: { readonly centers: Centers }) {
  if (centers.isError) return <p className="text-warning text-xs">{m.centers.loadFailed}</p>;
  if (centers.data?.more) return <p className="text-xs opacity-70">{m.centers.more}</p>;
  return null;
}

/** 센터 한 곳. 목록을 못 불러오면 코드 직접 입력 */
export function CenterSelect({
  centers,
  label,
  value,
  onChange,
}: {
  readonly centers: Centers;
  readonly label: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
}) {
  const options = centers.data?.options;
  return (
    <div className="flex flex-col gap-1 text-sm">
      {options ? (
        // 쳐서 찾는 고르기(2026-11-19 — 센터가 많아지면 드롭다운에서 찾기 힘들다). 센터 코드·이름으로, 초성도
        <div className="flex flex-col gap-1">
          <span>{label}</span>
          <SearchSelect label={label} className="w-full max-w-xs" value={value} placeholder={m.centers.choose} options={options} onChange={onChange} />
        </div>
      ) : (
        <label className="flex flex-col gap-1">
          {label}
          <input
            className="input input-sm w-full max-w-xs"
            maxLength={64}
            disabled={centers.isPending}
            placeholder={centers.isPending ? m.loading : m.fields.centerCode}
            value={value}
            onChange={(e) => onChange(e.target.value.trim())}
          />
        </label>
      )}
      <LoadNote centers={centers} />
    </div>
  );
}

const splitCodes = (text: string) =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** 센터 여러 곳. 목록을 못 불러오면 쉼표로 나눈 코드 입력 */
export function CenterMultiSelect({
  centers,
  label,
  value,
  onChange,
}: {
  readonly centers: Centers;
  readonly label: string;
  readonly value: readonly string[];
  readonly onChange: (next: string[]) => void;
}) {
  const options = centers.data?.options;
  return (
    <div className="flex flex-col gap-1 text-sm">
      {options ? (
        <MultiSelectDropdown
          label={label}
          options={options}
          value={value}
          onChange={onChange}
          placeholder={m.centers.choose}
          selectedText={m.centers.chosen}
        />
      ) : (
        <label className="flex flex-col gap-1">
          {label}
          <input
            className="input input-sm w-full"
            disabled={centers.isPending}
            placeholder={centers.isPending ? m.loading : m.centers.codesHint}
            defaultValue={value.join(', ')}
            onChange={(e) => onChange(splitCodes(e.target.value))}
          />
        </label>
      )}
      <LoadNote centers={centers} />
    </div>
  );
}
