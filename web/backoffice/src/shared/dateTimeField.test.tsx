import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { DateTimeField, displayLocal, parseTyped } from './DateTimeField';

function Harness({ initial, min }: { readonly initial: string; readonly min?: string }) {
  const [v, setV] = useState(initial);
  return (
    <label>
      시작
      <DateTimeField value={v} onChange={setV} min={min} />
      <output data-testid="value">{v}</output>
    </label>
  );
}
const value = () => screen.getByTestId('value').textContent;
const open = () => fireEvent.click(screen.getByLabelText('시작'));
const wheel = (id: string, deltaY: number) => fireEvent.wheel(screen.getByTestId(id), { deltaY });

describe('DateTimeField — 휠로 시각 돌리기', () => {
  it('59분에서 분을 한 칸 올리면 다음 시 00분', () => {
    render(<Harness initial="2026-11-24T09:59" />);
    open();
    wheel('wheel-minute', 100);
    expect(value()).toBe('2026-11-24T10:00');
    expect(screen.getByLabelText('시작')).toHaveValue('2026-11-24 오전 10:00');
    wheel('wheel-minute', -100);
    expect(value()).toBe('2026-11-24T09:59');
  });

  it('오전 11시에서 시를 올리면 오후 12시, 오후 11시에서 올리면 다음 날 오전 12시', () => {
    render(<Harness initial="2026-11-24T11:30" />);
    open();
    wheel('wheel-hour', 100);
    expect(value()).toBe('2026-11-24T12:30');
    expect(screen.getByLabelText('시작')).toHaveValue('2026-11-24 오후 12:30');
    fireEvent.change(screen.getByLabelText('시작'), { target: { value: '2026-11-30T23:59' } });
    wheel('wheel-minute', 100);
    expect(value()).toBe('2026-12-01T00:00');
  });

  it('오전/오후 줄은 12시간씩, 터치패드처럼 잘게 오는 휠은 모아서 한 칸', () => {
    render(<Harness initial="2026-11-24T09:00" />);
    open();
    wheel('wheel-half', 100);
    expect(value()).toBe('2026-11-24T21:00');
    wheel('wheel-minute', 40);
    wheel('wheel-minute', 40);
    expect(value()).toBe('2026-11-24T21:00');
    wheel('wheel-minute', 40);
    expect(value()).toBe('2026-11-24T21:01');
    // 한 번에 세 칸(빠르게 굴림)도 세 칸 모두
    wheel('wheel-minute', 300);
    expect(value()).toBe('2026-11-24T21:04');
  });

  it('min 보다 이르게는 돌아가지 않고, min 앞 날은 고를 수 없다', () => {
    render(<Harness initial="2026-11-24T10:00" min="2026-11-24T10:00" />);
    open();
    wheel('wheel-minute', -100);
    expect(value()).toBe('2026-11-24T10:00');
    expect(screen.getByRole('button', { name: '2026-11-23' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '2026-11-26' }));
    expect(value()).toBe('2026-11-26T10:00');
  });

  it('직접 치기: 오후 1:05·공백·T 모양', () => {
    expect(parseTyped('2026-11-24 오후 1:05')).toBe('2026-11-24T13:05');
    expect(parseTyped('2026-11-24 오전 12:00')).toBe('2026-11-24T00:00');
    expect(parseTyped('2026-11-24 13:05')).toBe('2026-11-24T13:05');
    expect(parseTyped('2026.11.24 9:05')).toBe('2026-11-24T09:05');
    expect(parseTyped('2026-02-30 10:00')).toBeNull();
    expect(parseTyped('2026-11-24 오후 13:00')).toBeNull();
    expect(displayLocal('2026-11-24T00:05')).toBe('2026-11-24 오전 12:05');
  });

  it('빈 칸에서 날을 누르면 그날 0시', () => {
    render(<Harness initial="" />);
    open();
    const day = screen.getAllByRole('button').find((b) => /^\d{4}-\d{2}-15$/.test(b.getAttribute('aria-label') ?? ''))!;
    fireEvent.click(day);
    expect(value()).toMatch(/^\d{4}-\d{2}-15T00:00$/);
  });
});
