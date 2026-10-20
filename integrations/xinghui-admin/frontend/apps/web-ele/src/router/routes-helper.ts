import type { Component, DefineComponent } from 'vue';
import type { RouteRecordRaw } from 'vue-router';
import type {
  ComponentRecordType,
  GenerateMenuAndRoutesOptions,
  RouteRecordStringComponent,
} from '@vben/types';
import { defineComponent, h } from 'vue';
import { cloneDeep, generateMenus, isFunction, isString, mapTree } from '@vben/utils';

/**
 * 本地版本的 generateAccessible，包含完整的路由注册和菜单生成
 * 用于后端动态路由模式
 */
async function generateAccessibleLocal(
  options: GenerateMenuAndRoutesOptions,
) {
  const { router } = options;

  options.routes = cloneDeep(options.routes);
  
  // 生成路由
  const accessibleRoutes = await generateRoutesLocal(options);

  console.log('[Route Debug] Generated routes:', accessibleRoutes.map(r => ({
    path: r.path,
    name: r.name,
    hasComponent: !!r.component,
    children: r.children?.map(c => ({ path: c.path, name: c.name }))
  })));

  const root = router.getRoutes().find((item) => item.path === '/');

  // 获取已有的路由名称列表
  const names = root?.children?.map((item) => item.name) ?? [];

  // 动态添加到router实例内
  accessibleRoutes.forEach((route) => {
    if (root && !route.meta?.noBasicLayout) {
      // 如果包含子路由，则将component移除
      if (route.children && route.children.length > 0) {
        delete route.component;
      }
      // 根据router name判断，如果路由已经存在，则更新
      if (names?.includes(route.name)) {
        const index = root.children?.findIndex(
          (item) => item.name === route.name,
        );
        if (index !== undefined && index !== -1 && root.children) {
          root.children[index] = route;
        }
      } else {
        root.children?.push(route);
      }
    } else {
      router.addRoute(route);
    }
  });

  if (root) {
    if (root.name) {
      router.removeRoute(root.name);
    }
    router.addRoute(root);
  }

  console.log('[Route Debug] Final registered routes:', router.getRoutes().map(r => r.path));

  // 生成菜单
  const accessibleMenus = generateMenus(accessibleRoutes, options.router);

  return { accessibleMenus, accessibleRoutes };
}

/**
 * 本地路由生成逻辑
 */
async function generateRoutesLocal(
  options: GenerateMenuAndRoutesOptions,
): Promise<RouteRecordRaw[]> {
  const { fetchMenuListAsync, layoutMap = {}, pageMap = {} } = options;

  const menuRoutes = await fetchMenuListAsync?.();
  if (!menuRoutes) {
    return [];
  }

  const normalizePageMap: ComponentRecordType = {};

  for (const [key, value] of Object.entries(pageMap)) {
    // 保留原始键
    normalizePageMap[key] = value;
    
    // 添加标准化后的键
    const normalizedKey = normalizeViewPath(key);
    normalizePageMap[normalizedKey] = value;
    
    // 添加不带 .vue 后缀的键
    if (normalizedKey.endsWith('.vue')) {
      const keyWithoutVue = normalizedKey.slice(0, -4);
      normalizePageMap[keyWithoutVue] = value;
      
      // 如果是 index.vue，也添加不带 /index 的路径
      if (keyWithoutVue.endsWith('/index')) {
        normalizePageMap[keyWithoutVue.slice(0, -6)] = value;
      }
    }
  }

  let resultRoutes = convertRoutes(menuRoutes, layoutMap, normalizePageMap);

  // 调整路由树：添加redirect、处理keepAlive组件名称
  resultRoutes = mapTree(resultRoutes, (route) => {
    // 重新包装component，使用与路由名称相同的name以支持keep-alive
    if (
      route.meta?.keepAlive &&
      isFunction(route.component) &&
      route.name &&
      isString(route.name)
    ) {
      const originalComponent = route.component as () => Promise<{
        default: Component | DefineComponent;
      }>;
      route.component = async () => {
        const component = await originalComponent();
        if (!component.default) return component;
        return defineComponent({
          name: route.name as string,
          setup(props, { attrs, slots }) {
            return () => h(component.default, { ...props, ...attrs }, slots);
          },
        });
      };
    }

    // 如果有redirect或者没有子路由，则直接返回
    if (route.redirect || !route.children || route.children.length === 0) {
      return route;
    }
    const firstChild = route.children[0];

    // 如果子路由以/开头，设置redirect
    if (firstChild?.path?.startsWith('/')) {
      route.redirect = firstChild.path;
    }

    return route;
  });

  return resultRoutes;
}

function convertRoutes(
  routes: RouteRecordStringComponent[],
  layoutMap: ComponentRecordType,
  pageMap: ComponentRecordType,
): RouteRecordRaw[] {
  return mapTree(routes, (node) => {
    const route = node as unknown as RouteRecordRaw;
    const { component, name } = node;

    if (!name) {
      console.error('route name is required', route);
    }

    // layout转换
    if (component && layoutMap[component]) {
      route.component = layoutMap[component];
    } else if (component) {
      const normalizePath = normalizeViewPath(component);
      // 移除开头的斜杠
      const pathWithoutLeadingSlash = normalizePath.replace(/^\//, '');
      
      // 尝试多种可能的键格式
      const possibleKeys = [
        // 直接匹配
        normalizePath,
        `${normalizePath}.vue`,
        pathWithoutLeadingSlash,
        `${pathWithoutLeadingSlash}.vue`,
        // 相对路径格式 (import.meta.glob 输出格式)
        `../views/${pathWithoutLeadingSlash}.vue`,
        `../views/${pathWithoutLeadingSlash}/index.vue`,
        // 添加 /index 后缀
        `${normalizePath}/index`,
        `${normalizePath}/index.vue`,
        `${pathWithoutLeadingSlash}/index.vue`,
        `../views/${pathWithoutLeadingSlash}`,
      ];

      const matchedKey = possibleKeys.find(key => pageMap[key]);

      if (matchedKey) {
        route.component = pageMap[matchedKey];
      } else {
        console.error(`Route component not found: ${component}`, 'Tried keys:', possibleKeys.slice(0, 5));
      }
    }

    return route;
  });
}

function normalizeViewPath(path: string): string {
  const normalizedPath = path.replace(/^(\.\/|\.\.\/)+/, '');
  const viewPath = normalizedPath.startsWith('/')
    ? normalizedPath
    : `/${normalizedPath}`;
  return viewPath.replace(/^\/views/, '');
}

export { generateAccessibleLocal };
