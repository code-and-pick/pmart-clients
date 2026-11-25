// DC 백오피스 뼈대(백엔드 요청 clients/all/2026-11-25-request-cdc-backoffice §2-1) — 로그인 앱 이름, DC 고르기, 메뉴 자리(설비·센서·자산 빼기), 역할 안내.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TokenStore } from '@pmart/web-core';
import { SOURCE_SYSTEM } from '../api/command';
import { beginEmployeeLogin, browser, LOGIN_SILENT_KEY } from '../api/employeeAuth';
import { env } from '../env';
import { messages as m } from '../shared/messages';
import { as, renderAt } from '../test/render';
import { allMenus } from './nav';

afterEach(() => {
  vi.restoreAllMocks();
  env.isMock = true;
});

describe('로그인', () => {
  it('app=cdc-backoffice, 복귀 주소 <출처>/auth/callback, X-Source-System cdc-backoffice-web', async () => {
    const url = new URL(await beginEmployeeLogin('https://192.168.0.40:8443/api/v1', '/', new TokenStore(), { origin: 'https://192.168.0.40:8447' }));
    expect(url.searchParams.get('app')).toBe('cdc-backoffice');
    expect(url.searchParams.get('returnUri')).toBe('https://192.168.0.40:8447/auth/callback');
    expect(SOURCE_SYSTEM).toBe('cdc-backoffice-web');
  });

  it('실서버 모드: 버튼은 게이트웨이 로그인 시작 주소로 옮긴다', async () => {
    env.isMock = false;
    sessionStorage.setItem(LOGIN_SILENT_KEY, '1');
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    renderAt('/login', null);
    await userEvent.click(screen.getByRole('button', { name: '직원 계정으로 로그인' }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(assign.mock.calls[0]![0]).toContain('/api/v1/employee-auth/logins?app=cdc-backoffice');
  });

  it('목 모드: 목 계정 버튼 → 티켓 교환 → 맡은 DC 의 첫 메뉴(준비 중)', async () => {
    renderAt('/', null);
    await userEvent.click(await screen.findByRole('button', { name: 'DC 관리자 — 칠곡 DC(claude-cdc-sup)' }));
    expect(await screen.findByRole('heading', { name: '대시보드·관제' })).toBeInTheDocument();
    expect(await screen.findByText('칠곡 중앙물류센터(칠곡 DC) (CDC01)')).toBeInTheDocument();
  });
});

describe('메뉴', () => {
  it('14개 메뉴가 모두 DC 아래 주소 — 설비·환경·물류 자산 메뉴는 없다', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { name: '대시보드·관제' })).toBeInTheDocument();
    for (const menu of allMenus) {
      expect(screen.getByRole('link', { name: m.menus[menu.key] })).toHaveAttribute('href', `/c/CDC01/${menu.segment}`);
    }
    expect(allMenus).toHaveLength(14);
    expect(screen.getByRole('link', { name: 'TRF·Wave' })).toHaveAttribute('href', '/c/CDC01/trf-wave');
    expect(screen.getByRole('link', { name: '재고관리' })).toHaveAttribute('href', '/c/CDC01/inventory');
    for (const gone of ['시설·설비', '환경·품질', '물류 자산']) expect(screen.queryByText(gone)).not.toBeInTheDocument();
  });

  it('아직 만들지 않은 메뉴는 "준비 중" — 지어낸 숫자 없이 서버 API 있고 없음만', async () => {
    renderAt('/c/CDC01/transport');
    expect(await screen.findByRole('heading', { name: '출하·운송' })).toBeInTheDocument();
    expect(screen.getByText('화면 준비 중')).toBeInTheDocument();
    expect(screen.getByTestId('api-missing')).toHaveTextContent('transport-*·fleet');
  });
});

describe('역할·DC', () => {
  it('CDC_WORKER 만 있으면 PDA 안내, 메뉴 없음', async () => {
    renderAt('/', as.worker);
    expect(await screen.findByText('현장 작업은 PDA 에서 해 주세요.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'TRF·Wave' })).not.toBeInTheDocument();
  });

  it('맡은 DC 가 없는 운영 관리자는 안내', async () => {
    renderAt('/', as.adminNoCenter);
    expect(await screen.findByText('맡은 DC 가 없어요.')).toBeInTheDocument();
  });

  it('남의 DC 주소면 막고 맡은 DC 로 가는 링크', async () => {
    renderAt('/c/CDC99/tasks');
    expect(await screen.findByText('이 DC 권한이 없습니다. 맡은 DC 를 골라 주세요.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CDC01' })).toHaveAttribute('href', '/c/CDC01/tasks');
  });

  it('DC 관리자·운영 관리자가 아니면 막지 않고 안내만', async () => {
    renderAt('/c/MFC-BJG-01/tasks', as.mfc);
    expect(await screen.findByText('DC 관리자 권한이 없어요.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '통합 작업관리' })).toBeInTheDocument();
  });

  it('운영 관리자(CDC01 포함)는 안내 없이 메뉴', async () => {
    renderAt('/c/CDC01/tasks', as.admin);
    expect(await screen.findByRole('heading', { name: '통합 작업관리' })).toBeInTheDocument();
    expect(screen.queryByText('DC 관리자 권한이 없어요.')).not.toBeInTheDocument();
  });
});

describe('머리줄', () => {
  it('앱 바꾸기 메뉴에 DC 백오피스가 지금 앱으로 강조', async () => {
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: '앱 바꾸기' }));
    const panel = screen.getByRole('navigation', { name: '앱 바꾸기' });
    expect(within(panel).getByText('DC 백오피스')).toHaveAttribute('aria-current', 'page');
    expect(within(panel).getByRole('link', { name: 'MFC 센터' })).toHaveAttribute('href', 'http://localhost:5175/');
  });

  it('내 정보: hr 본인 조회 이름·역할·DC', async () => {
    renderAt('/me');
    expect((await screen.findAllByText('칠관리')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/DC 관리자/).length).toBeGreaterThan(0);
    expect(await screen.findByText('칠곡 중앙물류센터(칠곡 DC) (CDC01)')).toBeInTheDocument();
  });
});
