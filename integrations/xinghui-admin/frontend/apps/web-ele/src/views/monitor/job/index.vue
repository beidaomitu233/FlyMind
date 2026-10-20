<script lang="ts" setup>
import { reactive, ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Page } from '@vben/common-ui';
import { 
  getJobList, 
  getJob,
  addJob, 
  updateJob, 
  removeJob 
} from '#/api/monitor/job';

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

// 弹窗控制
const dialogVisible = ref(false);
const dialogTitle = ref('新增任务');
const dialogLoading = ref(false);

// 表单数据
const form = reactive({
  jobId: undefined as number | undefined,
  jobName: '',
  jobGroup: 'DEFAULT',
  invokeTarget: '',
  cronExpression: '',
  misfirePolicy: '1',
  concurrent: '1',
  status: '0',
  remark: '',
});

const formRules = {
  jobName: [{ required: true, message: '请输入任务名称', trigger: 'blur' }],
  invokeTarget: [{ required: true, message: '请输入调用目标', trigger: 'blur' }],
  cronExpression: [{ required: true, message: '请输入cron表达式', trigger: 'blur' }],
};

const formRef = ref();

// 任务组选项
const jobGroupOptions = [
  { label: '默认', value: 'DEFAULT' },
  { label: '系统', value: 'SYSTEM' },
];

// 执行策略选项
const misfirePolicyOptions = [
  { label: '立即执行', value: '1' },
  { label: '执行一次', value: '2' },
  { label: '放弃执行', value: '3' },
];

// 获取任务列表
const getList = async () => {
  loading.value = true;
  try {
    const res = await getJobList({ ...queryParams, ...formInline });
    tableData.value = res.rows || res.records || [];
    total.value = Number(res.total) || 0;
  } catch (error) {
    console.error(error);
    ElMessage.error('获取任务列表失败');
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

// 重置表单
const resetForm = () => {
  form.jobId = undefined;
  form.jobName = '';
  form.jobGroup = 'DEFAULT';
  form.invokeTarget = '';
  form.cronExpression = '';
  form.misfirePolicy = '1';
  form.concurrent = '1';
  form.status = '0';
  form.remark = '';
};

// 新增
const handleAdd = () => {
  resetForm();
  dialogTitle.value = '新增任务';
  dialogVisible.value = true;
};

// 编辑
const handleEdit = async (row: any) => {
  resetForm();
  dialogTitle.value = '编辑任务';
  try {
    const res = await getJob(row.jobId);
    const data = res.data || res;
    Object.assign(form, {
      jobId: data.jobId,
      jobName: data.jobName,
      jobGroup: data.jobGroup,
      invokeTarget: data.invokeTarget,
      cronExpression: data.cronExpression,
      misfirePolicy: data.misfirePolicy,
      concurrent: data.concurrent,
      status: data.status,
      remark: data.remark,
    });
    dialogVisible.value = true;
  } catch (error) {
    ElMessage.error('获取任务信息失败');
  }
};

// 删除
const handleDelete = (row: any) => {
  ElMessageBox.confirm(`确定要删除任务"${row.jobName}"吗？`, '警告', {
    type: 'warning',
    confirmButtonText: '确定',
    cancelButtonText: '取消',
  }).then(async () => {
    try {
      await removeJob(String(row.jobId));
      ElMessage.success('删除成功');
      getList();
    } catch (error) {
      ElMessage.error('删除失败');
    }
  }).catch(() => {});
};

// 批量删除
const handleBatchDelete = () => {
  if (selectedIds.value.length === 0) {
    ElMessage.warning('请选择要删除的任务');
    return;
  }
  ElMessageBox.confirm(`确定要删除选中的${selectedIds.value.length}条任务吗？`, '警告', {
    type: 'warning',
    confirmButtonText: '确定',
    cancelButtonText: '取消',
  }).then(async () => {
    try {
      await removeJob(selectedIds.value.join(','));
      ElMessage.success('批量删除成功');
      selectedIds.value = [];
      getList();
    } catch (error) {
      ElMessage.error('批量删除失败');
    }
  }).catch(() => {});
};

// 选择变化
const handleSelectionChange = (selection: any[]) => {
  selectedIds.value = selection.map(item => item.jobId);
};

// 提交表单
const handleSubmit = async () => {
  try {
    await formRef.value?.validate();
    dialogLoading.value = true;
    
    if (form.jobId) {
      await updateJob(form);
      ElMessage.success('修改成功');
    } else {
      await addJob(form);
      ElMessage.success('新增成功');
    }
    
    dialogVisible.value = false;
    getList();
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(form.jobId ? '修改失败' : '新增失败');
    }
  } finally {
    dialogLoading.value = false;
  }
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
  <Page title="定时任务" description="管理系统定时任务">
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
            <el-option label="正常" value="0" />
            <el-option label="暂停" value="1" />
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
          <span>任务列表</span>
          <div>
            <el-button type="danger" :disabled="selectedIds.length === 0" @click="handleBatchDelete">
              批量删除
            </el-button>
            <el-button type="primary" @click="handleAdd">新增任务</el-button>
          </div>
        </div>
      </template>

      <!-- 表格 -->
      <el-table v-loading="loading" :data="tableData" stripe @selection-change="handleSelectionChange">
        <el-table-column type="selection" width="50" />
        <el-table-column prop="jobId" label="任务ID" width="80" />
        <el-table-column prop="jobName" label="任务名称" min-width="150" />
        <el-table-column prop="jobGroup" label="任务组" width="100" align="center">
          <template #default="{ row }">
            {{ getGroupName(row.jobGroup) }}
          </template>
        </el-table-column>
        <el-table-column prop="invokeTarget" label="调用目标" min-width="200" show-overflow-tooltip />
        <el-table-column prop="cronExpression" label="cron表达式" width="150" />
        <el-table-column prop="status" label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === '0' ? 'success' : 'info'">
              {{ row.status === '0' ? '正常' : '暂停' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="handleEdit(row)">
              编辑
            </el-button>
            <el-button type="danger" link size="small" @click="handleDelete(row)">
              删除
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

    <!-- 新增/编辑弹窗 -->
    <el-dialog 
      v-model="dialogVisible" 
      :title="dialogTitle" 
      width="600px"
      destroy-on-close
    >
      <el-form 
        ref="formRef"
        :model="form" 
        :rules="formRules" 
        label-width="120px"
      >
        <el-form-item label="任务名称" prop="jobName">
          <el-input v-model="form.jobName" placeholder="请输入任务名称" />
        </el-form-item>
        <el-form-item label="任务组">
          <el-select v-model="form.jobGroup" style="width: 100%">
            <el-option v-for="item in jobGroupOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="调用目标" prop="invokeTarget">
          <el-input v-model="form.invokeTarget" placeholder="请输入调用目标字符串" />
          <div class="text-xs text-gray-400 mt-1">
            Bean调用示例：taskService.doTask('params')
          </div>
        </el-form-item>
        <el-form-item label="cron表达式" prop="cronExpression">
          <el-input v-model="form.cronExpression" placeholder="请输入cron表达式" />
          <div class="text-xs text-gray-400 mt-1">
            示例：0 0/10 * * * ? 表示每10分钟执行一次
          </div>
        </el-form-item>
        <el-form-item label="执行策略">
          <el-radio-group v-model="form.misfirePolicy">
            <el-radio v-for="item in misfirePolicyOptions" :key="item.value" :value="item.value">
              {{ item.label }}
            </el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="是否并发">
          <el-radio-group v-model="form.concurrent">
            <el-radio value="0">允许</el-radio>
            <el-radio value="1">禁止</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio value="0">正常</el-radio>
            <el-radio value="1">暂停</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="请输入备注" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="dialogLoading" @click="handleSubmit">
          确定
        </el-button>
      </template>
    </el-dialog>
  </Page>
</template>

<style scoped>
.el-card {
  border-radius: 8px;
}
</style>
