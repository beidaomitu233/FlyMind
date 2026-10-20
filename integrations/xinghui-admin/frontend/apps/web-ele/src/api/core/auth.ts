import { requestClient } from '#/api/request';

export namespace AuthApi {
  /** 登录接口参数 */
  export interface LoginParams {
    phone: string;
    password: string;
    code?: string;
    uuid?: string;
  }

  /** 登录接口返回值 */
  export interface LoginResult {
    accessToken: string;
  }
}

/**
 * 登录
 */
export async function loginApi(data: AuthApi.LoginParams) {
  const token = await requestClient.post<string>('/user/login', data);
  return { accessToken: token };
}

/**
 * 退出登录
 */
export async function logoutApi() {
  return requestClient.post('/user/logout');
}

export interface CaptchaResult {
  enabled: boolean;
  img: string;
  uuid: string;
}

export async function getCaptchaApi() {
  return requestClient.get<CaptchaResult>('/captcha');
}
