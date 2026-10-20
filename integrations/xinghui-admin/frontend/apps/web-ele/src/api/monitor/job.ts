import { requestClient } from '#/api/request';

export interface JobInfo {
  jobId: number;
  jobName: string;
  jobGroup: string;
  invokeTarget: string;
  cronExpression: string;
  misfirePolicy: string;
  concurrent: string;
  status: string;
  createBy: string;
  createTime: string;
  updateBy: string;
  updateTime: string;
  remark: string;
}

export function getJobList(params: any) {
  return requestClient.get('/monitor/job/list', { params });
}

export function getJob(jobId: number) {
  return requestClient.get(`/monitor/job/${jobId}`);
}

export function addJob(data: any) {
  return requestClient.post('/monitor/job', data);
}

export function updateJob(data: any) {
  return requestClient.put('/monitor/job', data);
}

export function removeJob(jobIds: string) {
  return requestClient.delete(`/monitor/job/${jobIds}`);
}

// export function runJob(jobId: number) {
//   return requestClient.put('/monitor/job/run', { jobId });
// }

// export function changeJobStatus(jobId: number, status: string) {
//   return requestClient.put('/monitor/job/changeStatus', { jobId, status });
// }
