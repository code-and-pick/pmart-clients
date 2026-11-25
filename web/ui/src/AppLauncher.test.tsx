import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppLauncher, staffAppUrl } from './AppLauncher';

describe('staffAppUrl — 지금 페이지 호스트 + 앱 포트', () => {
  it('https(LAN): 같은 호스트, 443 은 포트 없음', () => {
    const lan = { protocol: 'https:', hostname: '192.168.0.40' };
    expect(staffAppUrl('backoffice', lan)).toBe('https://192.168.0.40/');
    expect(staffAppUrl('hr-backoffice', lan)).toBe('https://192.168.0.40:8444/');
    expect(staffAppUrl('mfc-backoffice', lan)).toBe('https://192.168.0.40:8445/');
    expect(staffAppUrl('rider-backoffice', { protocol: 'https:', hostname: 'd603-16' })).toBe('https://d603-16:8446/');
    expect(staffAppUrl('cdc-backoffice', { protocol: 'https:', hostname: 'd603-16' })).toBe('https://d603-16:8447/');
  });

  it('http(개발·목 localhost): 5173~5177', () => {
    const dev = { protocol: 'http:', hostname: 'localhost' };
    expect(staffAppUrl('backoffice', dev)).toBe('http://localhost:5173/');
    expect(staffAppUrl('hr-backoffice', dev)).toBe('http://localhost:5174/');
    expect(staffAppUrl('mfc-backoffice', dev)).toBe('http://localhost:5175/');
    expect(staffAppUrl('rider-backoffice', dev)).toBe('http://localhost:5176/');
    expect(staffAppUrl('cdc-backoffice', dev)).toBe('http://localhost:5177/');
  });
});

describe('AppLauncher', () => {
  it('누르면 5개 모두 보이고, 지금 앱은 링크 없이 강조, 나머지는 같은 탭 링크', () => {
    render(<AppLauncher current="hr-backoffice" />);
    const button = screen.getByRole('button', { name: '앱 바꾸기' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('navigation', { name: '앱 바꾸기' });
    expect(within(panel).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['백오피스', '인사팀', 'MFC 센터', '라이더 운영', 'DC 백오피스']);
    expect(within(panel).getByText('인사팀')).toHaveAttribute('aria-current', 'page');
    expect(within(panel).queryByRole('link', { name: '인사팀' })).not.toBeInTheDocument();
    const links = within(panel).getAllByRole('link');
    expect(links).toHaveLength(4);
    for (const a of links) {
      expect(a).not.toHaveAttribute('target'); // 같은 탭
      expect(a.getAttribute('href')).toMatch(/^http:\/\/localhost:517\d\/$/); // jsdom = http://localhost
    }
  });

  it('Esc·바깥 클릭으로 닫힌다', () => {
    render(
      <div>
        <p>바깥</p>
        <AppLauncher current="backoffice" />
      </div>,
    );
    const button = screen.getByRole('button', { name: '앱 바꾸기' });
    fireEvent.click(button);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    fireEvent.mouseDown(screen.getByText('바깥'));
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});
