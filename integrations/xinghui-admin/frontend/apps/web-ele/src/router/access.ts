import type {
  ComponentRecordType,
  GenerateMenuAndRoutesOptions,
} from '@vben/types';

import { generateAccessible } from '@vben/access';
import { preferences } from '@vben/preferences';

import { ElMessage } from 'element-plus';

import { getAllMenusApi } from '#/api';
import { BasicLayout, IFrameView } from '#/layouts';
import { $t } from '#/locales';
import { generateAccessibleLocal } from './routes-helper';

const forbiddenComponent = () => import('#/views/_core/fallback/forbidden.vue');

async function generateAccess(options: GenerateMenuAndRoutesOptions) {
  const pageMap: ComponentRecordType = import.meta.glob('../views/**/*.vue');

  const layoutMap: ComponentRecordType = {
    BasicLayout,
    IFrameView,
  };

  const fetchMenuListAsync = async () => {
    ElMessage({
      duration: 1500,
      message: `${$t('common.loadingMenu')}...`,
    });
    return await getAllMenusApi();
  };

  // 后端动态路由模式
  if (preferences.app.accessMode === 'backend') {
    return await generateAccessibleLocal({
      ...options,
      fetchMenuListAsync,
      forbiddenComponent,
      layoutMap,
      pageMap,
    });
  }

  // 前端静态路由模式
  return await generateAccessible(preferences.app.accessMode, {
    ...options,
    fetchMenuListAsync,
    forbiddenComponent,
    layoutMap,
    pageMap,
  });
}

export { generateAccess };
