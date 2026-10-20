<script lang="ts" setup>
import { reactive, ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Page } from '@vben/common-ui';
import { 
  getOperLogList, 
  removeOperLog,
  cleanOperLog
} from '#/api/monitor/operlog';

// 搜索表单
const formInline = reactive({
  title: '',
  operName: '',
  businessType: '',
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

// 业务类型映射
const businessTypeMap: Record<number, string> = {
  0: '其它',
  1: '新增',
  2: '修改',
  3: '删除',
  4: '授权',
  5: '导出',
  6: '导入',
  7: '强退',
  8: '生成代码',
  9: '清空数据',
};

// 获取日志列表
const getList = async () => {
  loading.value = true;
  try {
    const res = await getOperLogList({ ...queryParams, ...formInline });
    tableData.value = res.rows || res.records || [];
    total.value = Number(res.total) || 0;
  } catch (error) {
    console.error(error);
    ElMessage.error('获取操作日志列表失败');
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
  formInline.title = '';
  formInline.operName = '';
  formInline.businessType = '';
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
      await removeOperLog(selectedIds.value);
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
  ElMessageBox.confirm('确定要清空所有操作日志吗？此操作不可恢复！', '警告', {
    type: 'warning',
    confirmButtonText: '确定',
    cancelButtonText: '取消',
  }).then(async () => {
    try {
      await cleanOperLog();
      ElMessage.success('清空成功');
      getList();
    } catch (error) {
      ElMessage.error('清空失败');
    }
  }).catch(() => {});
};

// 选择变化
const handleSelectionChange = (selection: any[]) => {
  selectedIds.value = selection.map(item => item.operId);
};

// 分页变化
const handlePageChange = () => {
  getList();
};

// 获取业务类型名称
const getBusinessTypeName = (type: number) => {
  return businessTypeMap[type] || '未知';
};

// 获取业务类型标签颜色
type BusinessTagColor = 'primary' | 'success' | 'warning' | 'info' | 'danger';
const getBusinessTypeColor = (type: number): BusinessTagColor | undefined => {
  const colorMap: Partial<Record<number, BusinessTagColor>> = {
    1: 'success',
    2: 'warning',
    3: 'danger',
    4: 'primary',
    5: 'info',
    6: 'info',
  };
  return colorMap[type];
};

onMounted(() => {
  getList();
});
</script>

<template>
  <Page title="操作日志" description="查看系统操作日志记录">
    <!-- 搜索区域 -->
    <el-card class="mb-4" shadow="never">
      <el-form :inline="true" :model="formInline">
        <el-form-item label="系统模块">
          <el-input 
            v-model="formInline.title" 
            placeholder="请输入系统模块" 
            clearable
            @keyup.enter="handleSearch"
          />
        </el-form-item>
        <el-form-item label="操作人员">
          <el-input 
            v-model="formInline.operName" 
            placeholder="请输入操作人员" 
            clearable
            @keyup.enter="handleSearch"
          />
        </el-form-item>
        <el-form-item label="操作类型">
          <el-select v-model="formInline.businessType" placeholder="请选择类型" clearable style="width: 120px">
            <el-option v-for="(name, type) in businessTypeMap" :key="type" :label="name" :value="type" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="formInline.status" placeholder="请选择状态" clearable style="width: 100px">
            <el-option label="成功" :value="0" />
            <el-option label="失败" :value="1" />
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
        <el-table-column prop="operId" label="日志ID" width="80" />
        <el-table-column prop="title" label="系统模块" min-width="120" />
        <el-table-column prop="businessType" label="操作类型" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="getBusinessTypeColor(row.businessType)">
              {{ getBusinessTypeName(row.businessType) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="operName" label="操作人员" width="120" />
        <el-table-column prop="operIp" label="操作IP" width="140" />
        <el-table-column prop="status" label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 0 ? 'success' : 'danger'">
              {{ row.status === 0 ? '成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="operTime" label="操作时间" width="180" />
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
      title="操作日志详情" 
      width="700px"
    >
      <el-descriptions :column="2" border>
        <el-descriptions-item label="操作模块">{{ detailData.title }}</el-descriptions-item>
        <el-descriptions-item label="操作类型">
          <el-tag :type="getBusinessTypeColor(detailData.businessType)">
            {{ getBusinessTypeName(detailData.businessType) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="请求方式">{{ detailData.requestMethod }}</el-descriptions-item>
        <el-descriptions-item label="操作人员">{{ detailData.operName }}</el-descriptions-item>
        <el-descriptions-item label="部门名称">{{ detailData.deptName }}</el-descriptions-item>
        <el-descriptions-item label="操作IP">{{ detailData.operIp }}</el-descriptions-item>
        <el-descriptions-item label="操作地点">{{ detailData.operLocation }}</el-descriptions-item>
        <el-descriptions-item label="操作状态">
          <el-tag :type="detailData.status === 0 ? 'success' : 'danger'">
            {{ detailData.status === 0 ? '成功' : '失败' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="操作时间" :span="2">{{ detailData.operTime }}</el-descriptions-item>
        <el-descriptions-item label="操作方法" :span="2">{{ detailData.method }}</el-descriptions-item>
        <el-descriptions-item label="请求URL" :span="2">{{ detailData.operUrl }}</el-descriptions-item>
        <el-descriptions-item label="请求参数" :span="2">
          <div class="max-h-32 overflow-auto">{{ detailData.operParam }}</div>
        </el-descriptions-item>
        <el-descriptions-item label="返回参数" :span="2">
          <div class="max-h-32 overflow-auto">{{ detailData.jsonResult }}</div>
        </el-descriptions-item>
        <el-descriptions-item v-if="detailData.status === 1" label="错误消息" :span="2">
          <span class="text-red-500">{{ detailData.errorMsg }}</span>
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
