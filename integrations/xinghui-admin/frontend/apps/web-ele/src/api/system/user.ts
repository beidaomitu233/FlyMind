import { requestClient } from '#/api/request';

export interface UserInfo {
  userId: number;
  userName: string;
  nickName: string;
  email: string;
  phonenumber: string;
  sex: string;
  avatar: string;
  status: string;
  createTime: string;
}

export function getUserList(params: any) {
  return requestClient.get('/system/user/list', { params });
}

export function getUser(userId: string | undefined) {
  return requestClient.get(`/system/user/getuser`, { params: { userId } });
}

export function addUser(data: any) {
  return requestClient.post('/system/user/add', data);
}

export function updateUser(data: any) {
  return requestClient.post('/system/user/edit', data);
}

export function removeUser(userId: string) {
  return requestClient.post(`/system/user/remove`, null, { params: { userId } });
}

export function resetUserPwd(data: any) {
  return requestClient.post('/system/user/resetPwd', data);
}
