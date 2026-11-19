// 이미지 고르기·저장 흐름. 실제 multipart 전송은 vitest+jsdom fetch 가 못 보내므로 올리기 함수는 대체하고
// (`imageUpload.test.ts` 가 호출 내용을 본다) 화면이 무엇을 언제 넘기는지와 결과 표시를 본다.
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ContentImage } from '../../api/models';
import { renderAt } from '../../test/render';
import type { PendingImage } from './ImagePicker';
import type { UploadOutcome } from './imageUpload';

const uploadMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<UploadOutcome>>());
vi.mock('./imageUpload', () => ({ uploadPendingImages: uploadMock }));

const png = (name: string) => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });
// user-event 의 upload 는 파일을 다시 만들어 이름이 바뀔 수 있어 change 이벤트로 그대로 넘긴다.
const upload = (input: HTMLElement, files: File | File[]) => fireEvent.change(input, { target: { files: Array.isArray(files) ? files : [files] } });

/** 넘어온 pending 을 전부 성공으로 돌려준다(sortOrder 는 역할 안 순서). */
const allSucceed = async (...args: unknown[]): Promise<UploadOutcome> => {
  const pending = args[2] as readonly PendingImage[];
  const count: Record<string, number> = {};
  const uploaded: ContentImage[] = pending.map((p, i) => {
    const sortOrder = p.role === 'MAIN' ? 0 : (count[p.role] = (count[p.role] ?? -1) + 1);
    return { imageId: `img-${i}`, role: p.role, sortOrder };
  });
  return { uploaded, failed: [] };
};

describe('콘텐츠 등록 — 이미지', () => {
  it('폼에서 대표 1장·상세설명 2장을 고르고(제거 포함) 초안 저장을 누르면 초안을 만든 뒤 그 초안 ID 로 차례로 올린다', async () => {
    uploadMock.mockReset();
    uploadMock.mockImplementation(allSucceed);
    const user = userEvent.setup();
    const view = renderAt('/contents/drafts/new');

    upload((await screen.findByLabelText('대표 이미지 추가')), png('main.png'));
    upload(screen.getByLabelText('상세설명 이미지 추가'), [png('d1.png'), png('d2.png'), png('d3.png')]);
    // 상세설명 세 번째는 빼 본다.
    await user.click(screen.getByRole('button', { name: 'd3.png 제거' }));
    expect(within(screen.getByRole('list', { name: '상세설명 이미지 목록' })).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('고른 이미지 3장은 초안을 만든 뒤 바로 올라가요')).toBeInTheDocument();

    // 대표는 1장 — 다시 고르면 바뀐다.
    upload(screen.getByLabelText('대표 이미지 추가'), png('main2.png'));
    expect(within(screen.getByRole('list', { name: '대표 이미지 목록' })).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'main2.png 제거' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('고객용 상품명'), '사과');
    await user.click(screen.getByRole('button', { name: '초안 저장' }));

    // 초안이 먼저 만들어지고(POST /content-drafts), 그 ID 로 고른 순서대로 넘긴다.
    await screen.findByText('콘텐츠 초안');
    expect(view.mutations('/content-drafts')).toHaveLength(1);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [, draftId, pending] = uploadMock.mock.calls[0]! as [unknown, string, readonly PendingImage[]];
    expect(draftId).toMatch(/^cd-/);
    expect(pending.map((p) => [p.role, p.file.name])).toEqual([
      ['DESCRIPTION', 'd1.png'],
      ['DESCRIPTION', 'd2.png'],
      ['MAIN', 'main2.png'],
    ]);
    view.stop();
  });

  it('일부 이미지가 실패하면 초안은 만들어진 채 남겨 두고, 올린 수·실패 수와 초안 화면 링크를 보이며 실패한 장만 남긴다', async () => {
    uploadMock.mockReset();
    uploadMock.mockImplementation(async (...args: unknown[]) => {
      const pending = args[2] as readonly PendingImage[];
      const ok = await allSucceed(...args);
      return {
        uploaded: ok.uploaded.slice(0, 1),
        failed: pending.slice(1).map((image) => ({ image, failure: new Error('503') as never })),
      };
    });
    const user = userEvent.setup();
    renderAt('/contents/drafts/new');

    upload((await screen.findByLabelText('대표 이미지 추가')), png('main.png'));
    upload(screen.getByLabelText('상세설명 이미지 추가'), png('d1.png'));
    await user.type(screen.getByLabelText('고객용 상품명'), '사과');
    await user.click(screen.getByRole('button', { name: '초안 저장' }));

    expect(await screen.findByText(/이미지 1장을 올렸고 1장은 올리지 못했어요/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '초안 화면 열기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'd1.png 제거' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'main.png 제거' })).not.toBeInTheDocument();
    // 초안 화면으로 자동 이동하지 않는다.
    expect(screen.getByRole('heading', { name: '콘텐츠 등록(개별)' })).toBeInTheDocument();
  });

  it('기존 초안 화면에서는 고르는 즉시 올리고 결과를 보인다', async () => {
    uploadMock.mockReset();
    uploadMock.mockImplementation(allSucceed);
    const user = userEvent.setup();
    renderAt('/contents/drafts/new');
    await user.type((await screen.findByLabelText('고객용 상품명')), '사과');
    await user.click(screen.getByRole('button', { name: '초안 저장' }));
    await screen.findByText('콘텐츠 초안');
    expect(uploadMock).not.toHaveBeenCalled();

    upload(await screen.findByLabelText('상세정보 표 이미지 추가'), png('info.png'));

    expect(await screen.findByText('이미지 1장을 올렸어요')).toBeInTheDocument();
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [, , pending] = uploadMock.mock.calls[0]! as [unknown, string, readonly PendingImage[]];
    expect(pending.map((p) => [p.role, p.file.name])).toEqual([['DETAIL', 'info.png']]);
  });
});
