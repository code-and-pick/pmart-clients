// 긴 상세 이미지 자르기(2026-11-18): 자를 자리 계산 + 화면이 조각을 상세설명 끝에 순서대로 붙이는지.
// 실제 canvas 자르기는 jsdom 에 없어 slicer 를 바꿔 끼운다(브라우저에서 눈으로 확인).
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ImagePicker, type PendingImage } from './ImagePicker';
import { pieceName, slicePlan, type SliceResult } from './sliceImage';

const png = (name: string) => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });

describe('자를 자리', () => {
  it('높이 3500 을 1500 씩: 1500·1500·500', () => {
    expect(slicePlan(3500, 1500)).toEqual([
      { y: 0, h: 1500 },
      { y: 1500, h: 1500 },
      { y: 3000, h: 500 },
    ]);
  });
  it('마지막이 조각 높이의 20% 미만이면 앞 조각에 붙인다(3100 → 1500·1600)', () => {
    expect(slicePlan(3100, 1500)).toEqual([
      { y: 0, h: 1500 },
      { y: 1500, h: 1600 },
    ]);
  });
  it('조각 높이 이하면 한 장', () => {
    expect(slicePlan(900, 1500)).toEqual([{ y: 0, h: 900 }]);
  });
  it('조각 이름은 원본이름_01 … 형식', () => {
    expect(pieceName('detail.long.jpg', 0, 'image/jpeg')).toBe('detail.long_01.jpg');
    expect(pieceName('a.png', 9, 'image/png')).toBe('a_10.png');
  });
});

function Harness({ slicer, initial = [] }: { readonly slicer: (f: File, h: number) => Promise<SliceResult>; readonly initial?: readonly PendingImage[] }) {
  const [pending, setPending] = useState<readonly PendingImage[]>(initial);
  return <ImagePicker pending={pending} onChange={setPending} slicer={slicer} />;
}

describe('긴 이미지 잘라 넣기', () => {
  it('고른 조각 높이로 잘라, 상세설명에 이미 고른 것 뒤에 순서대로 붙인다', async () => {
    const user = userEvent.setup();
    const slicer = vi.fn<(f: File, h: number) => Promise<SliceResult>>(async () => ({ pieces: [png('long_01.png'), png('long_02.png'), png('long_03.png')], width: 860, height: 4200 }));
    render(<Harness slicer={slicer} />);
    const desc = screen.getByRole('region', { name: '상세설명' });
    fireEvent.change(within(desc).getByLabelText('상세설명 이미지 추가'), { target: { files: [png('first.png')] } });

    await user.selectOptions(within(desc).getByLabelText('조각 높이'), '2000');
    fireEvent.change(within(desc).getByLabelText('잘라 넣을 긴 상세 이미지'), { target: { files: [png('long.png')] } });

    expect(await within(desc).findByTestId('slice-done')).toHaveTextContent('860×4,200px 를 3조각으로');
    expect(slicer).toHaveBeenCalledWith(expect.any(File), 2000);
    const names = within(within(desc).getByRole('list', { name: '상세설명 이미지 목록' })).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'));
    expect(names).toEqual(['올릴 이미지 first.png', '올릴 이미지 long_01.png', '올릴 이미지 long_02.png', '올릴 이미지 long_03.png']);
  });

  it('조각 높이를 바꾸면 이미 넣은 조각을 같은 자리에서 새 높이로 바로 다시 자른다(2026-11-18)', async () => {
    const user = userEvent.setup();
    const slicer = vi.fn<(f: File, h: number) => Promise<SliceResult>>(async (_f, h) =>
      h === 1000
        ? { pieces: [png('long_01.png'), png('long_02.png'), png('long_03.png'), png('long_04.png')], width: 860, height: 4000 }
        : { pieces: [png('long_01.png'), png('long_02.png')], width: 860, height: 4000 },
    );
    render(<Harness slicer={slicer} />);
    const desc = screen.getByRole('region', { name: '상세설명' });
    fireEvent.change(within(desc).getByLabelText('상세설명 이미지 추가'), { target: { files: [png('first.png'), png('last.png')] } });
    fireEvent.change(within(desc).getByLabelText('잘라 넣을 긴 상세 이미지'), { target: { files: [png('long.png')] } });
    await within(desc).findByText(/2조각으로/);
    const names = () => within(within(desc).getByRole('list', { name: '상세설명 이미지 목록' })).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'));
    expect(names()).toHaveLength(4);

    await user.selectOptions(within(desc).getByLabelText('조각 높이'), '1000');
    expect(await within(desc).findByText(/4조각으로/)).toBeInTheDocument();
    expect(slicer).toHaveBeenLastCalledWith(expect.any(File), 1000);
    // 앞뒤로 고른 사진은 그대로, 조각만 4장으로 바뀜(늘어나지 않고 바뀜)
    expect(names()).toEqual(['올릴 이미지 first.png', '올릴 이미지 last.png', '올릴 이미지 long_01.png', '올릴 이미지 long_02.png', '올릴 이미지 long_03.png', '올릴 이미지 long_04.png']);
  });

  it('조각을 다 지운 뒤 높이를 바꾸면 다시 넣지 않는다', async () => {
    const user = userEvent.setup();
    const slicer = vi.fn<(f: File, h: number) => Promise<SliceResult>>(async () => ({ pieces: [png('long_01.png'), png('long_02.png')], width: 860, height: 3000 }));
    render(<Harness slicer={slicer} />);
    const desc = screen.getByRole('region', { name: '상세설명' });
    fireEvent.change(within(desc).getByLabelText('잘라 넣을 긴 상세 이미지'), { target: { files: [png('long.png')] } });
    await within(desc).findByText(/2조각으로/);
    await user.click(within(desc).getByRole('button', { name: 'long_01.png 제거' }));
    await user.click(within(desc).getByRole('button', { name: 'long_02.png 제거' }));
    await user.selectOptions(within(desc).getByLabelText('조각 높이'), '1000');
    await new Promise((r) => setTimeout(r, 50));
    expect(within(desc).queryByRole('list', { name: '상세설명 이미지 목록' })).not.toBeInTheDocument();
  });

  it('못 읽으면 안내하고 목록은 그대로', async () => {
    const slicer = vi.fn(async (): Promise<SliceResult> => {
      throw new Error('decode');
    });
    render(<Harness slicer={slicer} />);
    const desc = screen.getByRole('region', { name: '상세설명' });
    fireEvent.change(within(desc).getByLabelText('잘라 넣을 긴 상세 이미지'), { target: { files: [png('broken.png')] } });
    expect(await within(desc).findByRole('alert')).toHaveTextContent('이미지를 읽지 못했어요');
    expect(within(desc).queryByRole('list')).not.toBeInTheDocument();
  });

  it('대표·상세정보 표에는 자르기 칸이 없다', () => {
    render(<Harness slicer={vi.fn()} />);
    expect(within(screen.getByRole('region', { name: '대표' })).queryByTestId('slice-box')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '상세정보 표' })).queryByTestId('slice-box')).not.toBeInTheDocument();
  });
});
