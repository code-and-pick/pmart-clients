import { render } from '@testing-library/react';

import { App } from '../app/App';
import { mockOperators, mockTokenFor } from '../mocks/operators';
import { server } from './server';

export const as = {
  admin: mockTokenFor(mockOperators[0]),
  md: mockTokenFor(mockOperators[1]),
  approver: mockTokenFor(mockOperators[2]),
  center: mockTokenFor(mockOperators[3]),
  cs: mockTokenFor(mockOperators[4]),
  riderOps: mockTokenFor(mockOperators[5]),
  csRider: mockTokenFor(mockOperators[6]),
  marketing: mockTokenFor(mockOperators[7]),
  marketing2: mockTokenFor(mockOperators[8]),
};

/** 화면 + 보낸 요청 기록(헤더 확인용) */
export function renderAt(path: string, token: string = as.md) {
  const sent: Request[] = [];
  const listener = ({ request }: { request: Request }) => {
    sent.push(request.clone());
  };
  server.events.on('request:start', listener);
  const view = render(<App memory initialPath={path} initialToken={token} />);
  return {
    ...view,
    sent,
    stop: () => server.events.removeListener('request:start', listener),
    mutations: (pathPart: string) => sent.filter((r) => r.method !== 'GET' && new URL(r.url).pathname.includes(pathPart)),
  };
}
