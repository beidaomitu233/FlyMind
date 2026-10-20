<script lang="ts" setup>
import { reactive, ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Page } from '@vben/common-ui';
import { 
  getJobLogList, 
  removeJobLog,
  cleanJobLog
} from '#/api/monitor/jobLog';

// 搜索表单
const formInline = reactive({
  jobName: '',
  jobGroup: '',
  status: '',
});

// 表格数据
const tableData = ref<any[]>([]);
const total = ref(0);
const loading = ref(false);
const selectedIds = ref<number[]>([]);
const queryParams = reactive({
  pageNum: 1,
  pageSize: 10,
});

// 详情弹窗
const detailVisible = ref(false);
const detailData = ref<any>({});

// 任务组选项
const jobGroupOptions = [
  { label: '默认', value: 'DEFAULT' },
  { label: '系统', value: 'SYSTEM' },
];

// 获取日志列表
const getList = async () => {
  loading.value = true;
  try {
    const res = await getJobLogList({ ...queryParams, ...formInline });
    tableData.value = res.rows || res.records || [];
    total.value = Number(res.total) || 0;
  } catch (error) {
    console.error(error);
    ElMessage.error('获取调度日志列表失败');
  } finally {
    loading.value = false;
  }
};

// 搜索
const handleSearch = () => {
  queryParams.pageNum = 1;
  getList();
};

// 重置搜索
const handleReset = () => {
  formInline.jobName = '';
  formInline.jobGroup = '';
  formInline.status = '';
  handleSearch();
};

// 查看详情
const handleDetail = (row: any) => {
  detailData.value = row;
  detailVisible.value = true;
};

// 删除
const handleDelete = () => {
  if (selectedIds.value.length === 0) {
    ElMessage.warning('请选择要删除的日志');
    return;
  }
  ElMessageBox.confirm(`确定要删除选中的${selectedIds.value.length}条日志吗？`, '警告', {
    type: 'warning',
    confirmButtonText: '确定',
    cancelButtonText: '取消',
  }).then(async () => {
    try {
      await removeJobLog(selectedIds.value.join(','));
      ElMessage.success('删除成功');
      selectedIds.value = [];
      getList();
    } catch (error) {
      ElMessage.error('删除失败');
    }
  }).catch(() => {});
};

// 清空日志
const handleClean = () => {
  ElMessageBox.confirm('确定要清空所有调度日志吗？此操作不可恢复！', '警告', {
    type: 'warning',
    confirmButtonText: '确定',
    cancelButtonText: '取消',
  }).then(async () => {
    try {
      await cleanJobLog();
      ElMessage.success('清空成功');
      getList();
    } catch (error) {
      ElMessage.error('清空失败');
    }
  }).catch(() => {});
};

// 选择变化
const handleSelectionChange = (selection: any[]) => {
  selectedIds.value = selection.map(item => item.jobLogId);
};

// 分页变化
const handlePageChange = () => {
  getList();
};

// 获取任务组名称
const getGroupName = (group: string) => {
  const item = jobGroupOptions.find(opt => opt.value === group);
  return item?.label || group;
};

onMounted(() => {
  getList();
});
</script>

<template>
  <Page title="调度日志" description="查看定时任务执行日志">
    <!-- 搜索区域 -->
    <el-card class="mb-4" shadow="never">
      <el-form :inline="true" :model="formInline">
        <el-form-item label="任务名称">
          <el-input 
            v-model="formInline.jobName" 
            placeholder="请输入任务名称" 
            clearable
            @keyup.enter="handleSearch"
          />
        </el-form-item>
        <el-form-item label="任务组">
          <el-select v-model="formInline.jobGroup" placeholder="请选择任务组" clearable style="width: 120px">
            <el-option v-for="item in jobGroupOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="formInline.status" placeholder="请选择状态" clearable style="width: 100px">
            <el-option label="成功" value="0" />
            <el-option label="失败" value="1" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch">搜索</el-button>
          <el-button @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 操作区域 -->
    <el-card shadow="never">
      <template #header>
        <div class="flex justify-between items-center">
          <span>日志列表</span>
          <div>
            <el-button type="danger" :disabled="selectedIds.length === 0" @click="handleDelete">
              删除
            </el-button>
            <el-button type="danger" @click="handleClean">
              清空
            </el-button>
          </div>
        </div>
      </template>

      <!-- 表格 -->
      <el-table v-loading="loading" :data="tableData" stripe @selection-change="handleSelectionChange">
        <el-table-column type="selection" width="50" />
        <el-table-column prop="jobLogId" label="日志ID" width="80" />
        <el-table-column prop="jobName" label="任务名称" min-width="150" />
        <el-table-column prop="jobGroup" label="任务组" width="100" align="center">
          <template #default="{ row }">
            {{ getGroupName(row.jobGroup) }}
          </template>
        </el-table-column>
        <el-table-column prop="invokeTarget" label="调用目标" min-width="200" show-overflow-tooltip />
        <el-table-column prop="jobMessage" label="日志信息" min-width="150" show-overflow-tooltip />
        <el-table-column prop="status" label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === '0' ? 'success' : 'danger'">
              {{ row.status === '0' ? '成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createTime" label="执行时间" width="180" />
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="handleDetail(row)">
              详情
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="mt-4 flex justify-end">
        <el-pagination
          v-model:current-page="queryParams.pageNum"
          v-model:page-size="queryParams.pageSize"
          :total="total"
          :page-sizes="[10, 20, 50, 100]"
          background
          layout="total, sizes, prev, pager, next, jumper"
          @change="handlePageChange"
        />
      </div>
    </el-card>

    <!-- 详情弹窗 -->
    <el-dialog 
      v-model="detailVisible" 
      title="调度日志详情" 
      width="700px"
    >
      <el-descriptions :column="2" border>
        <el-descriptions-item label="任务名称">{{ detailData.jobName }}</el-descriptions-item>
        <el-descriptions-item label="任务组">{{ getGroupName(detailData.jobGroup) }}</el-descriptions-item>
        <el-descriptions-item label="执行状态">
          <el-tag :type="detailData.status === '0' ? 'success' : 'danger'">
            {{ detailData.status === '0' ? '成功' : '失败' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="执行时间">{{ detailData.createTime }}</el-descriptions-item>
        <el-descriptions-item label="调用目标" :span="2">{{ detailData.invokeTarget }}</el-descriptions-item>
        <el-descriptions-item label="日志信息" :span="2">{{ detailData.jobMessage }}</el-descriptions-item>
        <el-descriptions-item v-if="detailData.status === '1'" label="异常信息" :span="2">
          <div class="text-red-500 max-h-32 overflow-auto">{{ detailData.exceptionInfo }}</div>
        </el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </Page>
</template>

<style scoped>
.el-card {
  border-radius: 8px;
}
</style>
