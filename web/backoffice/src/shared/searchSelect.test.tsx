// 쳐서 찾는 고르기 칸(2026-11-19)
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { chosungOf, matches, SearchSelect } from './SearchSelect';

const OPTS = [
  { value: 'c1', label: '송파 MFC', hint: 'MFC-SEL-01', keywords: 'MFC-SEL-01' },
  { value: 'c2', label: '부산 MFC', hint: 'MFC-BSN-01', keywords: 'MFC-BSN-01' },
  { value: 'c3', label: '성수 MFC', hint: 'MFC-SEL-02', keywords: 'MFC-SEL-02' },
];

function Box() {
  const [v, setV] = useState('');
  return (
    <>
      <SearchSelect label="센터" value={v} options={OPTS} allowEmpty="모든 센터" onChange={setV} />
      <p data-testid="chosen">{v || '(없음)'}</p>
    </>
  );
}

describe('찾기 규칙', () => {
  it('글자·띄어쓰기 무시·초성·숨은 낱말(코드)', () => {
    expect(chosungOf('송파')).toBe('ㅅㅍ');
    expect(matches(OPTS[0]!, '송 파')).toBe(true);
    expect(matches(OPTS[0]!, 'ㅅㅍ')).toBe(true);
    expect(matches(OPTS[1]!, 'ㅅㅍ')).toBe(false);
    expect(matches(OPTS[1]!, 'bsn')).toBe(true);
  });
});

describe('쳐서 찾는 고르기 칸', () => {
  it('넣은 말로 좁히고 ↓ Enter 로 고른다, Esc 는 고르지 않고 닫는다', async () => {
    const user = userEvent.setup();
    render(<Box />);
    const box = screen.getByRole('combobox', { name: '센터' });
    await user.click(box);
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(4); // 모든 센터 + 3
    await user.type(box, 'ㅅㅅ'); // 성수 초성
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringContaining('성수')]);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByTestId('chosen')).toHaveTextContent('c3');
    expect(box).toHaveValue('성수 MFC');
    await user.click(box);
    await user.type(box, '부산');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('chosen')).toHaveTextContent('c3'); // 그대로
    expect(box).toHaveValue('성수 MFC');
  });

  it('맞는 것이 없으면 안내, "모든 센터"로 비울 수 있다', async () => {
    const user = userEvent.setup();
    render(<Box />);
    const box = screen.getByRole('combobox', { name: '센터' });
    await user.click(box);
    await user.type(box, '제주');
    expect(screen.getByRole('listbox')).toHaveTextContent('맞는 것이 없어요.');
    await user.clear(box);
    await user.click(screen.getByRole('option', { name: '모든 센터' }));
    expect(screen.getByTestId('chosen')).toHaveTextContent('(없음)');
  });
});
