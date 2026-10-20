import { requestClient } from '#/api/request';

export interface FileInfo {
  id: number;
  filename: string;
  originalName: string;
  url: string;
  size: number;
  ext: string;
  platform: string;
  createTime: string;
}

export function getFileList(params: any) {
  return requestClient.get('/file/list', { params });
}

export function uploadFile(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  return requestClient.post('/file/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
}

// 后端使用fileId参数
export function removeFile(fileId: string) {
  return requestClient.post('/file/remove', null, { params: { fileId } });
}

export function removeBatchFile(fileIds: string[]) {
  return requestClient.post('/file/removeBatch', fileIds);
}

// 后端使用fileId参数
export function downloadFile(fileId: string) {
  return requestClient.get('/file/download', { 
    params: { fileId },
    responseType: 'blob',
  });
}

export function getFileUrl(fileId: string) {
  return requestClient.get(`/file/url/${fileId}`);
}
