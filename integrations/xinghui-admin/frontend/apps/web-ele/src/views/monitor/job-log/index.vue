<script lang="ts" setup>
import { reactive, ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Page } from '@vben/common-ui';
import { getJobLogList, removeJobLog, cleanJobLog } from '#/api/monitor/jobLog';

const formInline = reactive({
  jobName: '',
  jobGroup: '',
  status: '',
});

const tableData = ref([]);
const total = ref(0);
const loading = ref(false);
const queryParams = reactive({
  pageNum: 1,
  pageSize: 10,
});

const getList = async () => {
  loading.value = true;
  try {
    const res = await getJobLogList({ ...queryParams, ...formInline });
    tableData.value = res.rows || [];
    total.value = Number(res.total) || 0;
  } catch (error) {
    console.error(error);
  } finally {
    loading.value = false;
  }
};

const handleSearch = () => {
  queryParams.pageNum = 1;
  getList();
};

const handleReset = () => {
  formInline.jobName = '';
  formInline.jobGroup = '';
  formInline.status = '';
  handleSearch();
};

const handleDelete = (row: any) => {
  ElMessageBox.confirm('Are you sure to delete this log?', 'Warning', {
    type: 'warning',
  }).then(async () => {
    await removeJobLog(row.jobLogId);
    ElMessage.success('Delete success');
    getList();
  });
};

const handleClean = () => {
  ElMessageBox.confirm('Are you sure to clean all logs?', 'Warning', {
    type: 'warning',
  }).then(async () => {
    await cleanJobLog();
    ElMessage.success('Clean success');
    getList();
  });
};

onMounted(() => {
  getList();
});
</script>

<template>
  <Page title="Job Log">
    <div class="mb-4">
      <el-form :inline="true" :model="formInline">
        <el-form-item label="Job Name">
          <el-input v-model="formInline.jobName" placeholder="Job Name" />
        </el-form-item>
        <el-form-item label="Group">
          <el-select v-model="formInline.jobGroup" placeholder="Select Group" clearable>
            <el-option label="Default" value="DEFAULT" />
            <el-option label="System" value="SYSTEM" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch">Search</el-button>
          <el-button @click="handleReset">Reset</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="mb-4">
      <el-button type="danger" @click="handleClean">Clean All</el-button>
    </div>

    <el-table v-loading="loading" :data="tableData" style="width: 100%">
      <el-table-column prop="jobLogId" label="ID" width="80" />
      <el-table-column prop="jobName" label="Job Name" />
      <el-table-column prop="jobGroup" label="Group" />
      <el-table-column prop="invokeTarget" label="Invoke Target" show-overflow-tooltip />
      <el-table-column prop="jobMessage" label="Message" show-overflow-tooltip />
      <el-table-column prop="status" label="Status" />
      <el-table-column prop="createTime" label="Exec Time" />
      <el-table-column label="Operations" width="100">
        <template #default="scope">
          <el-button size="small" type="text" @click="handleDelete(scope.row)">Delete</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="mt-4 flex justify-end">
      <el-pagination
        v-model:current-page="queryParams.pageNum"
        v-model:page-size="queryParams.pageSize"
        :total="total"
        :page-sizes="[10, 20, 50, 100]"
        background
        layout="total, sizes, prev, pager, next, jumper"
        @change="getList"
      />
    </div>
  </Page>
</template>
