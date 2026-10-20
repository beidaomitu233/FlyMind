import type { RouteRecordStringComponent } from '@vben/types';

import { requestClient } from '#/api/request';

/**
 * 转换后端菜单数据为前端路由格式
 * @param menu 后端菜单数据
 * @param parentPath 父级路径，用于生成子路由的绝对路径
 */
function transformMenuToRoute(menu: any, parentPath: string = ''): RouteRecordStringComponent {
  // 处理路径
  let path = menu.path || '';
  
  // 生成完整的绝对路径
  if (parentPath) {
    // 子路由：拼接父路径
    path = path.startsWith('/') ? path : `${parentPath}/${path}`;
  } else {
    // 顶级路由：确保以 / 开头
    path = path.startsWith('/') ? path : `/${path}`;
  }

  // 处理组件
  // menuType: M = 目录，需要使用 BasicLayout
  // menuType: C = 菜单，需要使用实际页面组件
  let component = 'BasicLayout';
  if (menu.menuType === 'C' && menu.component) {
    // 确保组件路径以 / 开头
    component = menu.component.startsWith('/') ? menu.component : `/${menu.component}`;
  } else if (menu.component && menu.component !== 'Layout' && menu.component !== 'ParentView') {
    // 其他情况，如果有 component 且不是布局组件
    component = menu.component.startsWith('/') ? menu.component : `/${menu.component}`;
  }

  // 生成路由名称
  // 确保名称唯一，使用 menuId 可以保证唯一性
  let name = menu.name || 
    menu.menuName?.replace(/[\s\u4e00-\u9fa5]/g, '') || 
    `Menu${menu.menuId}`;
  
  // 如果是目录，加后缀避免与子菜单重名
  if (menu.menuType === 'M') {
      name = `${name}Parent`;
  }

  const route: RouteRecordStringComponent = {
    name,
    path,
    component,
    meta: {
      title: menu.menuName || menu.meta?.title || '',
      icon: menu.icon || menu.meta?.icon || '',
      orderNo: menu.orderNum || menu.meta?.orderNo,
      hideInMenu: menu.visible === '1',
      ...menu.meta,
    },
  };

  // 递归处理子菜单，传入当前路径作为父路径
  if (menu.children && menu.children.length > 0) {
    route.children = menu.children.map((child: any) => transformMenuToRoute(child, path));
  }

  return route;
}


/**
 * 获取用户所有菜单
 */
export async function getAllMenusApi() {
  const res = await requestClient.get<any>('/user/router');
  // 后端可能返回 { routers: [...] } 或直接返回数组
  let menus: any[] = [];
  if (Array.isArray(res)) {
    menus = res;
  } else {
    menus = res?.routers || res?.data || [];
  }
  // 转换为前端路由格式
  const routes = menus.map((menu) => transformMenuToRoute(menu, ''));
  return routes;
}
