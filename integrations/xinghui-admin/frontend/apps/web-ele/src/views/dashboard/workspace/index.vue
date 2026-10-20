<script lang="ts" setup>
import type {
  WorkbenchProjectItem,
  WorkbenchQuickNavItem,
  WorkbenchTodoItem,
  WorkbenchTrendItem,
} from '@vben/common-ui';

import { ref } from 'vue';
import { useRouter } from 'vue-router';

import {
  AnalysisChartCard,
  WorkbenchHeader,
  WorkbenchProject,
  WorkbenchQuickNav,
  WorkbenchTodo,
  WorkbenchTrends,
} from '@vben/common-ui';
import { preferences } from '@vben/preferences';
import { useUserStore } from '@vben/stores';
import { openWindow } from '@vben/utils';

import AnalyticsVisitsSource from '../analytics/analytics-visits-source.vue';

const userStore = useUserStore();

// 项目快捷入口
const projectItems: WorkbenchProjectItem[] = [
  {
    color: '#3fb27f',
    content: '管理系统角色和权限分配',
    date: new Date().toLocaleDateString(),
    group: '系统管理',
    icon: 'carbon:user-role',
    title: '角色管理',
    url: '/system/role',
  },
  {
    color: '#e18525',
    content: '配置系统菜单和导航结构',
    date: new Date().toLocaleDateString(),
    group: '系统管理',
    icon: 'carbon:menu',
    title: '菜单管理',
    url: '/system/menu',
  },
  {
    color: '#bf0c2c',
    content: '发布和管理系统通知公告',
    date: new Date().toLocaleDateString(),
    group: '基础设施',
    icon: 'carbon:notification',
    title: '通知公告',
    url: '/infra/notice',
  },
  {
    color: '#00d8ff',
    content: '查看系统操作日志记录',
    date: new Date().toLocaleDateString(),
    group: '系统监控',
    icon: 'carbon:activity',
    title: '操作日志',
    url: '/monitor/operlog',
  },
  {
    color: '#4daf1bc9',
    content: '管理系统定时任务调度',
    date: new Date().toLocaleDateString(),
    group: '系统监控',
    icon: 'carbon:time',
    title: '定时任务',
    url: '/monitor/job',
  },
  {
    color: '#EBD94E',
    content: '管理系统上传的文件资源',
    date: new Date().toLocaleDateString(),
    group: '基础设施',
    icon: 'carbon:folder',
    title: '文件管理',
    url: '/infra/file',
  },
];

// 快捷导航
const quickNavItems: WorkbenchQuickNavItem[] = [
  {
    color: '#1fdaca',
    icon: 'ion:bar-chart-outline',
    title: '数据看板',
    url: '/analytics',
  },
  {
    color: '#3fb27f',
    icon: 'ion:people-outline',
    title: '角色管理',
    url: '/system/role',
  },
  {
    color: '#e18525',
    icon: 'ion:menu-outline',
    title: '菜单管理',
    url: '/system/menu',
  },
  {
    color: '#bf0c2c',
    icon: 'ion:notifications-outline',
    title: '通知公告',
    url: '/infra/notice',
  },
  {
    color: '#00d8ff',
    icon: 'ion:document-text-outline',
    title: '操作日志',
    url: '/monitor/operlog',
  },
  {
    color: '#4daf1bc9',
    icon: 'ion:timer-outline',
    title: '定时任务',
    url: '/monitor/job',
  },
];

// 待办事项
const todoItems = ref<WorkbenchTodoItem[]>([
  {
    completed: false,
    content: `检查系统角色权限配置是否正确`,
    date: new Date().toISOString(),
    title: '角色权限检查',
  },
  {
    completed: false,
    content: `审核新添加的菜单配置`,
    date: new Date().toISOString(),
    title: '菜单配置审核',
  },
  {
    completed: false,
    content: `确认定时任务执行状态`,
    date: new Date().toISOString(),
    title: '任务状态确认',
  },
]);

// 动态列表
const trendItems: WorkbenchTrendItem[] = [
  {
    avatar: 'svg:avatar-1',
    content: `配置了 <a>菜单管理</a> 模块`,
    date: '刚刚',
    title: '管理员',
  },
  {
    avatar: 'svg:avatar-2',
    content: `更新了 <a>角色权限</a>`,
    date: '1小时前',
    title: '系统',
  },
  {
    avatar: 'svg:avatar-3',
    content: `发布了 <a>系统公告</a>`,
    date: '2小时前',
    title: '管理员',
  },
  {
    avatar: 'svg:avatar-4',
    content: `清理了 <a>操作日志</a>`,
    date: '昨天',
    title: '系统',
  },
];

const router = useRouter();

function navTo(nav: WorkbenchProjectItem | WorkbenchQuickNavItem) {
  if (nav.url?.startsWith('http')) {
    openWindow(nav.url);
    return;
  }
  if (nav.url?.startsWith('/')) {
    router.push(nav.url);
  }
}

// 获取问候语
const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 6) return '凌晨好';
  if (hour < 9) return '早上好';
  if (hour < 12) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 17) return '下午好';
  if (hour < 19) return '傍晚好';
  return '晚上好';
};
</script>

<template>
  <div class="p-5">
    <WorkbenchHeader
      :avatar="userStore.userInfo?.avatar || preferences.app.defaultAvatar"
    >
      <template #title>
        {{ getGreeting() }}, {{ userStore.userInfo?.realName || '管理员' }}！欢迎使用星辉管理系统
      </template>
      <template #description>
        今天是 {{ new Date().toLocaleDateString('zh-CN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) }}
      </template>
    </WorkbenchHeader>

    <div class="mt-5 flex flex-col lg:flex-row">
      <div class="mr-4 w-full lg:w-3/5">
        <WorkbenchProject :items="projectItems" title="快捷入口" @click="navTo" />
        <WorkbenchTrends :items="trendItems" class="mt-5" title="最新动态" />
      </div>
      <div class="w-full lg:w-2/5">
        <WorkbenchQuickNav
          :items="quickNavItems"
          class="mt-5 lg:mt-0"
          title="快捷导航"
          @click="navTo"
        />
        <WorkbenchTodo :items="todoItems" class="mt-5" title="待办事项" />
        <AnalysisChartCard class="mt-5" title="访问来源">
          <AnalyticsVisitsSource />
        </AnalysisChartCard>
      </div>
    </div>
  </div>
</template>
