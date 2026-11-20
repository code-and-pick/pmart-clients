// 공용 콘솔 부품(2026-11-20 올림) — 앱 없이도 확인되는 것: 기간 단추·숫자 칸 누르기·조회 단추 없는 검색 줄·처음 펼침·표 설정(CSP 안전)·눈금
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { addSeoulDays, niceMax, PeriodPresets, SearchPanel, seoulToday, StatCard, TableSettings } from './index';

describe('공용 콘솔 부품', () => {
  it('niceMax — 깔끔한 눈금 위 끝', () => {
    expect(niceMax(0)).toBe(4);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(23)).toBe(25);
    expect(niceMax(180)).toBe(200);
  });

  it('기간 단추 — "7일"은 오늘부터 6일 전 ~ 오늘(서울), 같은 범위면 눌려 보인다', () => {
    const onPick = vi.fn();
    const today = seoulToday();
    render(<PeriodPresets from={addSeoulDays(today, -6)} to={today} onPick={onPick} />);
    const seven = screen.getByRole('radio', { name: '7일' });
    expect(seven).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: '30일' }));
    expect(onPick).toHaveBeenCalledWith({ from: addSeoulDays(today, -29), to: today });
  });

  it('숫자 칸 onClick — 주소 없이 거르기 함수(단추), 고른 칸은 aria-current', () => {
    const onClick = vi.fn();
    render(<StatCard label="대기" value={3} onClick={onClick} active testId="c" />);
    const cell = screen.getByTestId('c');
    expect(cell.tagName).toBe('BUTTON');
    expect(cell).toHaveAttribute('aria-current', 'true');
    fireEvent.click(cell);
    expect(onClick).toHaveBeenCalled();
  });

  it('검색 줄 submit={false} — 조회·초기화 단추 없음, \'/\' 키가 찾는 data-search 표시', () => {
    render(
      <SearchPanel onSubmit={() => undefined} onReset={() => undefined} submit={false} label="거르기">
        <input aria-label="이름" />
      </SearchPanel>,
    );
    const form = screen.getByRole('form', { name: '거르기' });
    expect(within(form).queryByRole('button')).toBeNull();
    expect(form).toHaveAttribute('data-search');
  });

  it('검색 줄 startOpen={false} — 요약 칩이 있으면 처음엔 접어 둔다', () => {
    render(
      <SearchPanel onSubmit={() => undefined} onReset={() => undefined} summary={[['상태', '대기']]} startOpen={false} label="거르기">
        <input aria-label="이름" />
      </SearchPanel>,
    );
    expect(screen.queryByRole('textbox', { name: '이름' })).toBeNull();
  });

  it('표 설정 — 숨긴 칸은 칸마다 element.style(실서버 CSP style-src 가 막는 <style> 을 쓰지 않음)', () => {
    window.localStorage.setItem('pmart.backoffice.table.t', JSON.stringify({ hidden: [1], wrap: false }));
    const { container } = render(
      <div>
        <TableSettings storeKey="t" tableId="tbl-x" />
        <table id="tbl-x">
          <thead>
            <tr>
              <th>이름</th>
              <th>센터</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>가</td>
              <td>MFC-1</td>
            </tr>
          </tbody>
        </table>
      </div>,
    );
    expect((container.querySelectorAll('thead th')[1] as HTMLElement).style.display).toBe('none');
    expect((container.querySelectorAll('tbody td')[1] as HTMLElement).style.display).toBe('none');
    expect((container.querySelectorAll('tbody td')[0] as HTMLElement).style.display).toBe('');
    expect(container.querySelector('style')).toBeNull();
    window.localStorage.removeItem('pmart.backoffice.table.t');
  });
});
