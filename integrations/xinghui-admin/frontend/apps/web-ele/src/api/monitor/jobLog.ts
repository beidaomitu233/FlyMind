import { requestClient } from '#/api/request';

export interface JobLogInfo {
  jobLogId: number;
  jobName: string;
  jobGroup: string;
  invokeTarget: string;
  jobMessage: string;
  status: string;
  exceptionInfo: string;
  createTime: string;
}

export function getJobLogList(params: any) {
  return requestClient.get('/monitor/jobLog/list', { params });
}

export function removeJobLog(ids: string) {
  return requestClient.delete(`/monitor/jobLog/${ids}`);
}

export function cleanJobLog() {
  return requestClient.delete('/monitor/jobLog/clean');
}
