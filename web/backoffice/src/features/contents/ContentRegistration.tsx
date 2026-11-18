// 콘텐츠 신규 / 기존 게시 갱신 표시(BR-44, 백엔드 회신 2026-11-04). 서버 값(registration·지금 게시본)만 보인다.
// 심사 전 초안(DRAFT·SUBMITTED)만 서버가 채우고, 게시·반려된 초안은 null → "-". 화면이 게시 여부를 추정하지 않는다.
import { formatSeoul } from '@pmart/web-ui';
import { messages as m } from '../../shared/messages';

export interface ContentRegistrationValue {
  readonly registration?: string | null | undefined;
  readonly publishedContentVersion?: unknown;
  readonly publishedAt?: unknown;
}

export function ContentRegistration({ value }: { readonly value: ContentRegistrationValue }) {
  const r = value.registration;
  if (r !== 'NEW' && r !== 'UPDATE') return <span data-registration="none">{m.none}</span>;
  if (r === 'NEW') {
    return (
      <span className="badge badge-info badge-soft badge-sm" data-registration="NEW">
        {m.contents.registrationName.NEW}
      </span>
    );
  }
  const v = typeof value.publishedContentVersion === 'number' ? `v${value.publishedContentVersion}` : m.none;
  const at = typeof value.publishedAt === 'string' && value.publishedAt ? formatSeoul(value.publishedAt) : '';
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-registration="UPDATE">
      <span className="badge badge-warning badge-soft badge-sm">{m.contents.registrationName.UPDATE}</span>
      <span className="text-xs opacity-80">{m.contents.publishedNow(v, at)}</span>
    </span>
  );
}
