import exctronAxios from '../config/axios';

export function clearLocalDoc(params: any) {
    return exctronAxios.post('/doc/clean', params);
  }