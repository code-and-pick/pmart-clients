import { createContext, useContext } from 'react';

import { api as defaultApi, type Api } from '../api/client';

const ApiContext = createContext<Api>(defaultApi);

export const useApi = () => useContext(ApiContext);
