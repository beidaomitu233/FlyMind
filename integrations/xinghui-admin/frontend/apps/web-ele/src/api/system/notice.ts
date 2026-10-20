import { requestClient } from '#/api/request';

export interface NoticeInfo {
  noticeId: number;
  noticeTitle: string;
  noticeType: string;
  noticeContent: string;
  status: string;
  createBy: string;
  createTime: string;
  updateBy: string;
  updateTime: string;
  remark: string;
}

export function getNoticeList(params: any) {
  return requestClient.get('/system/notice/list', { params });
}

export function getNotice(noticeId: number) {
  return requestClient.get(`/system/notice/${noticeId}`);
}

export function addNotice(data: any) {
  return requestClient.post('/system/notice/add', data);
}

export function updateNotice(data: any) {
  return requestClient.post('/system/notice/edit', data);
}

export function removeNotice(noticeId: number) {
  return requestClient.post(`/system/notice/remove/${noticeId}`);
}

export function removeBatchNotice(noticeIds: number[]) {
  return requestClient.post('/system/notice/removeBatch', noticeIds);
}

export function changeNoticeStatus(noticeId: number, status: number) {
  return requestClient.post('/system/notice/changeStatus', null, { params: { noticeId, status } });
}
