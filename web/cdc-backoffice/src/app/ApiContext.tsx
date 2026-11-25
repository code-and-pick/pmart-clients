import { createContext, useContext, type ReactNode } from 'react';

import { api as defaultApi, type Api } from '../api/client';

const ApiContext = createContext<Api>(defaultApi);

/** 테스트에서 다른 fetch(가짜 응답)를 쓰도록 주입한다. */
export function ApiProvider({ api, children }: { readonly api: Api; readonly children: ReactNode }) {
  return <ApiContext value={api}>{children}</ApiContext>;
}

export const useApi = () => useContext(ApiContext);
