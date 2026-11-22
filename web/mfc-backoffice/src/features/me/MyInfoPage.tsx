// 내 정보 — 로그인한 직원 본인. 보기는 hr-service `GET /hr/employees/me`(모든 직원, LAN 에서 MFC_SUPERVISOR·MFC_WORKER 200 확인 — 백엔드 2026-11-18).
// 인사 기록이 없는 계정은 404 → 오류가 아니라 "기록 없음".
// 사용자 정정(2026-11-18, 백엔드 회신 reply-my-account): 이 화면의 "번호"는 로그인 비밀번호가 아니라 센터 휴게 번호, 연락처는 연락 수단 표시용.
// - 센터 휴게 번호(mfc-capacity 0.20.0) `GET·PUT /mfcs/{mfcId}/break-pin` — 작업자 목록 위와 같은 카드. 바꾸기는 MFC_SUPERVISOR.
// - 내 연락처(mfc-capacity 0.21.0) `GET·PUT /mfcs/{mfcId}/staff-contacts/me` {name, phone, email} + X-Expected-Version(처음 0).
//   빈 칸은 null 로 보내 지운다. 형식이 틀리면 400 VALIDATION_FAILED, 버전이 다르면 409 VERSION_CONFLICT.
//   화면에서도 형식을 먼저 막지만(phone 숫자·- 만 9~11자리, email, name 50자) 확정은 서버 판정.
// - 이 센터 연락처 목록 `GET /mfcs/{mfcId}/staff-contacts`(모든 운영자·라이더가 봄) — 서버 순서 그대로.
// - 회사 메일(로그인 ID)은 인사팀만 바꾼다. 연락처 값은 로그·주소·저장소에 남기지 않는다.
// 2026-11-23 통합 백오피스와 같은 "내 정보" 모양(공용 @pmart/web-ui/console MyInfoView): 프로필·업무·로그인(옛 "내 세션" /session 을 합침)·계정·보안 사이에
//   이 앱 칸(인사 정보·센터 휴게 번호·연락처)을 그대로 둔다. 운영자 ID·세션 ID 는 접힌 시스템 번호로.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { centerDisplayName, request } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { consoleMessages, InfoCard, LoginRows, MyInfoView } from '@pmart/web-ui/console';
import { commandParams } from '../../api/command';
import type { components as CapComponents } from '../../api/generated/mfc-capacity';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { messages } from '../../shared/messages';
import { Who } from '../../shared/OperatorLabel';
import { BreakPinCard } from '../workers/BreakPinCard';
import { useMe, type EmployeeSelf } from './useMe';

type StaffContact = CapComponents['schemas']['StaffContact'];

const m = messages.me;
const t = consoleMessages.account;

export function MyInfoPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { session, logout } = useSession();
  const centers = session?.centers ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const mfcId = picked && centers.includes(picked) ? picked : (centers[0] ?? null);
  const supervisor = session?.roles.includes('MFC_SUPERVISOR') ?? false;
  const query = useMe();
  const current = useQuery({
    queryKey: ['employee-auth', 'session', session?.subject],
    enabled: session !== null,
    queryFn: () => request('GET', api.employeeAuth.GET('/employee-auth/sessions/current', {})),
  });
  if (!session) return null;
  const roles = session.roles.map((r) => messages.roleName[r] ?? r);
  const centerNames = session.centers.map((c) => centerDisplayName(session, c));
  const extra = (
    <>
      <InfoCard title={m.hrInfo}>
        <QueryState state={toUiState(query, (me) => me === null)} onRetry={() => void query.refetch()} emptyText={m.noRecord}>
          {(me) => me && <Profile me={me} />}
        </QueryState>
      </InfoCard>
      {mfcId === null ? (
        <p className="rounded-box bg-base-100 p-4 text-sm" data-testid="me-no-center">
          {m.noCenter}
        </p>
      ) : (
        <div className="space-y-4" data-testid="me-center">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">{m.centerSection(mfcId)}</h2>
            {centers.length > 1 && (
              <label className="flex items-center gap-2 text-sm">
                {m.centerPick}
                <select className="select select-sm" value={mfcId} onChange={(e) => setPicked(e.target.value)}>
                  {centers.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <BreakPinCard key={`pin-${mfcId}`} mfcId={mfcId} canEdit={supervisor} />
          <MyContact key={`contact-${mfcId}`} mfcId={mfcId} />
          <CenterContacts mfcId={mfcId} me={session?.subject ?? null} />
        </div>
      )}
    </>
  );
  return (
    <MyInfoView
      name={query.data?.name ?? null}
      nameFallback={query.isError ? t.nameFailed : query.isPending ? '…' : t.nameUnknown}
      employeeNo={query.data?.employeeNo}
      roles={roles}
      noRolesNote={
        session.roles.length === 0 && (
          <p role="alert" className="alert alert-warning text-sm">
            {messages.employeeLogin.noRoles}
          </p>
        )
      }
      work={[[t.centers, centerNames.length > 0 ? centerNames.join(', ') : t.allCenters]]}
      login={
        <QueryState state={toUiState(current)} onRetry={() => void current.refetch()}>
          {(s) => <LoginRows app={s.app} issuedAt={formatSeoul(s.issuedAt)} expiresAt={formatSeoul(s.expiresAt)} />}
        </QueryState>
      }
      extra={extra}
      notes={[messages.employeeLogin.passwordNote, messages.employeeLogin.sharedPcNote, messages.session.ssoNote]}
      onLogout={() =>
        void logout().then((result) => {
          // 'redirecting' 이면 브라우저가 Keycloak 로그아웃 주소로 떠난다(→ /login 으로 돌아온다).
          if (result !== 'redirecting') void navigate('/login', { replace: true });
        })
      }
      systemIds={[
        { label: t.operatorId, id: session.subject },
        { label: t.sessionId, id: current.data?.sessionId },
      ]}
    />
  );
}

function Profile({ me }: { readonly me: EmployeeSelf }) {
  const rows: ReadonlyArray<readonly [string, string]> = [
    [m.fields.name, me.name],
    [m.fields.employeeNo, me.employeeNo],
    [m.fields.mailAddress, me.mailAddress],
    [m.fields.employmentType, m.employmentType[me.employmentType] ?? me.employmentType],
    [m.fields.affiliation, me.affiliation.type === 'CENTER' ? m.center(me.affiliation.code) : m.department(me.affiliation.code)],
    [m.fields.status, m.status[me.status] ?? me.status],
  ];
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm" data-testid="me-profile">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="opacity-70">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs opacity-70">{m.mailNote}</p>
    </div>
  );
}

const contactKey = (mfcId: string) => ['staff-contact-me', mfcId] as const;
const contactsKey = (mfcId: string) => ['staff-contacts', mfcId] as const;

/** 계약 형식(화면에서 먼저 막기 — 확정은 서버) */
const phoneOk = (v: string) => v === '' || (/^[\d-]+$/.test(v) && /^\d{9,11}$/.test(v.replace(/-/g, '')));
const emailOk = (v: string) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

function MyContact({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const query = useQuery({
    queryKey: contactKey(mfcId),
    queryFn: () => request('GET', api.capacity.GET('/mfcs/{mfcId}/staff-contacts/me', { params: { path: { mfcId } } })),
  });
  return (
    <div className="space-y-2 rounded-box bg-base-100 p-4 text-sm" data-testid="me-contact">
      <h2 className="font-bold">{m.contactTitle}</h2>
      <p className="text-xs opacity-70">{m.contactIntro}</p>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(c) => <ContactForm key={c.version} mfcId={mfcId} current={c} />}
      </QueryState>
    </div>
  );
}

function ContactForm({ mfcId, current }: { readonly mfcId: string; readonly current: StaffContact }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [name, setName] = useState(current.name ?? '');
  const [phone, setPhone] = useState(current.phone ?? '');
  const [email, setEmail] = useState(current.email ?? '');
  const t = { name: name.trim(), phone: phone.trim(), email: email.trim() };
  const nameOk = t.name.length <= 50;
  const valid = nameOk && phoneOk(t.phone) && emailOk(t.email);
  const changed = t.name !== (current.name ?? '') || t.phone !== (current.phone ?? '') || t.email !== (current.email ?? '');
  const save = useCommand(async (_: void, key) => {
    const r = await request(
      'PUT',
      api.capacity.PUT('/mfcs/{mfcId}/staff-contacts/me', {
        ...commandParams(key, { path: { mfcId }, version: current.version }),
        body: { name: t.name || null, phone: t.phone || null, email: t.email || null },
      }),
    );
    await Promise.all([queryClient.invalidateQueries({ queryKey: contactKey(mfcId) }), queryClient.invalidateQueries({ queryKey: contactsKey(mfcId) })]);
    return r;
  });
  const f = m.contactFields;
  return (
    <form
      className="space-y-2"
      aria-label={m.contactTitle}
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || !changed) return;
        if (save.phase.kind === 'rejected' || save.phase.kind === 'done') save.reset();
        void save.run();
      }}
    >
      <p className="text-xs opacity-70" data-testid="me-contact-saved">
        {current.version > 0 && current.updatedAt ? m.contactUpdatedAt(formatSeoul(current.updatedAt)) : m.contactNotSaved}
      </p>
      <div className="grid gap-2 md:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1">
            {f.name}
            <input className="input input-sm" autoComplete="off" maxLength={50} placeholder={m.contactNamePlaceholder} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {!nameOk && <span className="text-xs text-error">{m.contactNameTooLong}</span>}
        </div>
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1">
            {f.phone}
            <input className="input input-sm" type="tel" inputMode="tel" autoComplete="off" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          {!phoneOk(t.phone) && <span className="text-xs text-error">{m.contactPhoneInvalid}</span>}
        </div>
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1">
            {f.email}
            <input className="input input-sm" type="email" autoComplete="off" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {!emailOk(t.email) && <span className="text-xs text-error">{m.contactEmailInvalid}</span>}
        </div>
      </div>
      <button type="submit" className="btn btn-sm btn-primary" disabled={!valid || !changed || save.busy || save.phase.kind === 'unknown'}>
        {m.contactSave}
      </button>
      <CommandFeedback command={save}>{() => <p role="status">{m.contactSaved}</p>}</CommandFeedback>
    </form>
  );
}

function CenterContacts({ mfcId, me }: { readonly mfcId: string; readonly me: string | null }) {
  const api = useApi();
  const query = useQuery({
    queryKey: contactsKey(mfcId),
    queryFn: () => request('GET', api.capacity.GET('/mfcs/{mfcId}/staff-contacts', { params: { path: { mfcId } } })),
  });
  const c = m.contactsCol;
  return (
    <div className="space-y-2 rounded-box bg-base-100 p-4 text-sm" data-testid="center-contacts">
      <h2 className="font-bold">{m.contactsTitle}</h2>
      <p className="text-xs opacity-70">{m.contactsIntro}</p>
      <QueryState state={toUiState(query, (r) => r.items.length === 0)} onRetry={() => void query.refetch()} emptyText={m.contactsEmpty}>
        {(r) => (
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>{c.name}</th>
                  <th>{c.phone}</th>
                  <th>{c.email}</th>
                  <th>{c.updatedAt}</th>
                </tr>
              </thead>
              <tbody>
                {r.items.map((s) => (
                  <tr key={s.operatorId} data-testid="center-contact-row">
                    <td>
                      {s.name ? s.name : <Who id={s.operatorId} />}
                      {s.operatorId === me && <span className="badge badge-sm ml-1">{m.mine}</span>}
                    </td>
                    <td>{s.phone ?? messages.none}</td>
                    <td className="break-all">{s.email ?? messages.none}</td>
                    <td className="text-xs opacity-70">{s.updatedAt ? formatSeoul(s.updatedAt) : messages.none}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </div>
  );
}
