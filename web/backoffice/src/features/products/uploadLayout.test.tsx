// 올리기 화면 공통(2026-11-19 쿠팡 윙 상품 일괄등록 참고) — 상품·콘텐츠·가격 일괄 등록
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

describe.each([
  ['/products/import', as.md],
  ['/contents/import', as.md],
  ['/prices/import', as.md],
])('%s 올리기 화면', (path, who) => {
  it('"파일 올리기 요청" 상자만(주의 띠·[주의] 줄 없음, 2026-11-20), 파일을 고르기 전엔 올리기 단추가 꺼져 있다', async () => {
    const user = userEvent.setup();
    renderAt(path, who);
    expect(await screen.findByRole('region', { name: '파일 올리기 요청' })).toBeInTheDocument();
    expect(screen.queryByTestId('upload-caution')).not.toBeInTheDocument();
    expect(screen.queryByText(/^\[주의\]/)).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: '업로드·검증' });
    expect(button).toBeDisabled();
    await user.upload(screen.getByLabelText('seed-v1.zip'), new File(['x'], 'seed-v1.zip', { type: 'application/zip' }));
    expect(button).toBeEnabled();
  });
});
