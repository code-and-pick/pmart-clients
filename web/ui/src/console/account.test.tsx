// 공용 내 정보 메뉴·화면 틀(2026-11-23 — 네 앱이 같이 쓴다)
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { AccountMenu, initialOf, MyInfoView, RoleText } from './index';

describe('AccountMenu', () => {
  it('머리글자 + 이름, 누르면 사번·역할(글자)과 내 정보·로그아웃 — Esc 로 닫힘', () => {
    const onLogout = vi.fn();
    render(
      <MemoryRouter>
        <AccountMenu name="[목] 관리자" employeeNo="P2026-00001" roles={['운영 관리자', '상품 승인']} profileTo="/session" onLogout={onLogout} />
      </MemoryRouter>,
    );
    const trigger = screen.getByRole('button', { name: '[목] 관리자 — 내 정보 메뉴' });
    expect(trigger).toHaveTextContent('관'); // [목] 표시는 건너뛴 머리글자
    fireEvent.click(trigger);
    const menu = screen.getByTestId('user-menu');
    expect(menu).toHaveTextContent('P2026-00001');
    expect(menu).toHaveTextContent('운영 관리자, 상품 승인');
    expect(within(menu).queryByRole('button', { name: '운영 관리자' })).not.toBeInTheDocument(); // 역할은 단추가 아니다
    expect(within(menu).getByRole('menuitem', { name: '내 정보' })).toHaveAttribute('href', '/session');
    fireEvent.click(within(menu).getByRole('menuitem', { name: '로그아웃' }));
    expect(onLogout).toHaveBeenCalledOnce();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('user-menu')).not.toBeInTheDocument();
  });

  it('이름을 모르면 "내 정보"만 — 머리글자는 ?', () => {
    render(
      <MemoryRouter>
        <AccountMenu name={null} roles={[]} profileTo="/me" onLogout={() => undefined} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: '내 정보' })).toHaveTextContent('?내 정보');
    expect(initialOf('  김인사')).toBe('김');
  });
});

describe('MyInfoView', () => {
  it('프로필(이름·사번 · 역할) → 업무·로그인 → 앱별 칸 → 계정·보안, 시스템 번호는 접힌 칸에', () => {
    const onLogout = vi.fn();
    render(
      <MyInfoView
        name="김인사"
        nameFallback="…"
        employeeNo="P2026-00009"
        roles={['인사팀']}
        work={[['담당 센터', '센터 제한 없음']]}
        login={<p>로그인 칸</p>}
        extra={<p data-testid="extra">인사 정보 칸</p>}
        notes={['비밀번호 안내']}
        onLogout={onLogout}
        systemIds={[{ label: '운영자 ID', id: 'OP-1' }, { label: '세션 ID', id: undefined }]}
      />,
    );
    expect(screen.getByRole('heading', { name: '내 정보' })).toBeInTheDocument();
    expect(screen.getByTestId('my-profile')).toHaveTextContent('P2026-00009 · 인사팀');
    expect(screen.getByTestId('extra')).toBeInTheDocument();
    expect(screen.getByTestId('system-numbers')).toHaveTextContent('OP-1');
    expect(screen.getByTestId('system-numbers')).not.toHaveTextContent('세션 ID'); // 값 없는 줄은 빼고
    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it('RoleText — 첫 역할 + 나머지 수, 테두리 없는 글자', () => {
    render(<RoleText roles={['운영 관리자', 'MD', '상품 승인']} />);
    const el = screen.getByTestId('header-roles');
    expect(el).toHaveTextContent('운영 관리자+2');
    expect(el.className).not.toMatch(/border|rounded/);
  });
});
