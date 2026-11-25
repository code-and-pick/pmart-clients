import { render } from '@testing-library/react';

import { mockOperatorToken } from '@pmart/web-core';
import { App } from '../app/App';
import { server } from './server';

const token = (sub: string, roles: readonly string[], centers: readonly string[]) => mockOperatorToken({ sub, roles, centers, exp: 4_000_000_000 });

export const as = {
  sup: token('OP-cdc-sup', ['CDC_SUPERVISOR'], ['CDC01']),
  admin: token('OP-admin-cdc', ['OPERATOR_ADMIN'], ['CDC01']),
  adminNoCenter: token('OP-admin-1', ['OPERATOR_ADMIN'], []),
  worker: token('OP-cdc-wkr', ['CDC_WORKER'], ['CDC01']),
  mfc: token('OP-sup-1', ['MFC_SUPERVISOR'], ['MFC-BJG-01']),
  otherRole: token('OP-hr-1', ['HR_ADMIN'], ['CDC01']),
  mixed: token('OP-mixed', ['CDC_SUPERVISOR', 'MFC_SUPERVISOR'], ['MFC-BJG-01', 'CDC01']),
};

/** 화면 + 보낸 요청 기록(헤더·본문 확인용) */
export function renderAt(path: string, accessToken: string | null = as.sup) {
  const sent: Request[] = [];
  const listener = ({ request }: { request: Request }) => {
    sent.push(request.clone());
  };
  server.events.on('request:start', listener);
  const view = render(<App memory initialPath={path} {...(accessToken ? { initialToken: accessToken } : {})} />);
  return {
    ...view,
    sent,
    gets: (pathPart: string) => sent.filter((r) => r.method === 'GET' && new URL(r.url).pathname.includes(pathPart)),
  };
}
