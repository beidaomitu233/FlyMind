import { requestClient } from '#/api/request';

export interface RoleInfo {
  roleId: number;
  roleName: string;
  roleKey: string;
  roleSort: number;
  dataScope: string;
  menuCheckStrictly: boolean;
  deptCheckStrictly: boolean;
  status: string;
  delFlag: string;
  createBy: string;
  createTime: string;
  updateBy: string;
  updateTime: string;
  remark: string;
}

export function getRoleList(params: any) {
  return requestClient.get('/system/role/list', { params });
}

export function getRole(roleId: number | undefined) {
  return requestClient.get(`/system/role/${roleId}`);
}

export function addRole(data: any) {
  return requestClient.post('/system/role/add', data);
}

export function updateRole(data: any) {
  return requestClient.post('/system/role/edit', data);
}

export function removeRole(roleId: number) {
  return requestClient.post('/system/role/remove', null, { params: { roleId } });
}

export function changeRoleStatus(roleId: number, status: number) {
  return requestClient.post('/system/role/changeStatus', null, { params: { roleId, status } });
}

// 获取角色的菜单ID列表
export function getMenuIdsByRoleId(roleId: number) {
  return requestClient.get(`/system/role/menuIds/${roleId}`);
}

// 为角色分配菜单权限
export function assignMenusToRole(roleId: number, menuIds: number[]) {
  return requestClient.post('/system/role/assignMenus', menuIds, { params: { roleId } });
}
