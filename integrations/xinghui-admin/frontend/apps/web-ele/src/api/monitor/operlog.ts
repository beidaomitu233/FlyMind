import { requestClient } from '#/api/request';

export interface OperLogInfo {
  operId: number;
  title: string;
  businessType: number;
  method: string;
  requestMethod: string;
  operatorType: number;
  operName: string;
  deptName: string;
  operUrl: string;
  operIp: string;
  operLocation: string;
  operParam: string;
  jsonResult: string;
  status: number;
  errorMsg: string;
  operTime: string;
}

export function getOperLogList(params: any) {
  return requestClient.get('/monitor/operlog/list', { params });
}

export function removeOperLog(operIds: number[]) {
  return requestClient.post('/monitor/operlog/remove', operIds);
}

export function cleanOperLog() {
  return requestClient.post('/monitor/operlog/clean');
}
