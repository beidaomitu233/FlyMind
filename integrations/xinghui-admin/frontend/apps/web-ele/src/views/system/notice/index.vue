<script lang="ts" setup>
import { reactive, ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Page } from '@vben/common-ui';
import { 
  getNoticeList, 
  getNotice,
  addNotice, 
  updateNotice, 
  removeNotice,
  removeBatchNotice,
  changeNoticeStatus
} from '#/api/system/notice';

// 搜索表单
const formInline = reactive({
  noticeTitle: '',
  noticeType: '',
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
const dialogTitle = ref('新增公告');
const dialogLoading = ref(false);

// 表单数据
const form = reactive({
  noticeId: undefined as number | undefined,
  noticeTitle: '',
  noticeType: '1',
  noticeContent: '',
  status: '0', // 后端使用String类型: '0'正常 '1'关闭
  remark: '',
  startTime: '' as string,
  endTime: '' as string,
});

const formRules = {
  noticeTitle: [{ required: true, message: '请输入公告标题', trigger: 'blur' }],
  noticeType: [{ required: true, message: '请选择公告类型', trigger: 'change' }],
};

const formRef = ref();

// 公告类型选项（按数据库设计修正）
const noticeTypeOptions = [
  { label: '通知卡片', value: '1', description: '右下角小卡片提示' },
  { label: '强弹窗', value: '2', description: '页面居中弹窗' },
];

// 获取公告列表
const getList = async () => {
  loading.value = true;
  try {
    const res = await getNoticeList({ ...queryParams, ...formInline });
    tableData.value = res.rows || res.records || [];
    total.value = Number(res.total) || 0;
  } catch (error) {
    console.error(error);
    ElMessage.error('获取公告列表失败');
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
  formInline.noticeTitle = '';
  formInline.noticeType = '';
  formInline.status = '';
  handleSearch();
};

// 重置表单
const resetForm = () => {
  form.noticeId = undefined;
  form.noticeTitle = '';
  form.noticeType = '1';
  form.noticeContent = '';
  form.status = '0';
  form.remark = '';
  form.startTime = '';
  form.endTime = '';
};

// 新增
const handleAdd = () => {
  resetForm();
  dialogTitle.value = '新增公告';
  dialogVisible.value = true;
};

// 编辑
const handleEdit = async (row: any) => {
  resetForm();
  dialogTitle.value = '编辑公告';
  try {
    const res = await getNotice(row.noticeId);
    const data = res.data || res;
    // 处理noticeContent，如果是字节数组则转换为字符串
    let content = data.noticeContent;
    if (content && typeof content === 'object' && content.type === 'Buffer') {
      // Node Buffer格式
      content = new TextDecoder().decode(new Uint8Array(content.data));
    } else if (content && Array.isArray(content)) {
      // 纯字节数组
      content = new TextDecoder().decode(new Uint8Array(content));
    }
    Object.assign(form, {
      noticeId: data.noticeId,
      noticeTitle: data.noticeTitle,
      noticeType: String(data.noticeType),
      noticeContent: content || '',
      status: String(data.status), // 确保是字符串
      remark: data.remark || '',
      startTime: data.startTime || '',
      endTime: data.endTime || '',
    });
    dialogVisible.value = true;
  } catch (error) {
    ElMessage.error('获取公告信息失败');
  }
};

// 删除
const handleDelete = (row: any) => {
  ElMessageBox.confirm(`确定要删除公告"${row.noticeTitle}"吗？`, '警告', {
    type: 'warning',
    confirmButtonText: '确定',
    cancelButtonText: '取消',
  }).then(async () => {
    try {
      await removeNotice(row.noticeId);
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
    ElMessage.warning('请选择要删除的公告');
    return;
  }
  ElMessageBox.confirm(`确定要删除选中的${selectedIds.value.length}条公告吗？`, '警告', {
    type: 'warning',
    confirmButtonText: '确定',
    cancelButtonText: '取消',
  }).then(async () => {
    try {
      await removeBatchNotice(selectedIds.value);
      ElMessage.success('批量删除成功');
      selectedIds.value = [];
      getList();
    } catch (error) {
      ElMessage.error('批量删除失败');
    }
  }).catch(() => {});
};

// 切换状态
const handleStatusChange = async (row: any) => {
  const currentStatus = String(row.status);
  const newStatus = currentStatus === '0' ? 1 : 0;
  const statusText = newStatus === 0 ? '已发布' : '已下架';
  
  try {
    await ElMessageBox.confirm(`确定要将公告状态改为"${statusText}"吗？`, '提示', {
      type: 'warning',
    });
    await changeNoticeStatus(row.noticeId, newStatus);
    ElMessage.success(`修改成功`);
    getList();
  } catch (error) {
    // 用户取消或请求失败
  }
};

// 选择变化
const handleSelectionChange = (selection: any[]) => {
  selectedIds.value = selection.map(item => item.noticeId);
};

// 提交表单
const handleSubmit = async () => {
  try {
    await formRef.value?.validate();
    dialogLoading.value = true;
    
    // 构造提交数据，确保类型正确
    const submitData = {
      ...form,
      noticeType: Number(form.noticeType),
      status: Number(form.status),
      // 日期已经是字符串格式（value-format设置）
    };
    
    if (form.noticeId) {
      await updateNotice(submitData);
      ElMessage.success('修改成功');
    } else {
      await addNotice(submitData);
      ElMessage.success('新增成功');
    }
    
    dialogVisible.value = false;
    getList();
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(form.noticeId ? '修改失败' : '新增失败');
    }
  } finally {
    dialogLoading.value = false;
  }
};

// 分页变化
const handlePageChange = () => {
  getList();
};

// 获取类型名称
const getTypeName = (type: string) => {
  const item = noticeTypeOptions.find(opt => opt.value === type);
  return item?.label || type;
};

// 检查是否在生效时间内
const isInEffectTime = (row: any) => {
  const now = new Date();
  if (row.startTime && new Date(row.startTime) > now) return false;
  if (row.endTime && new Date(row.endTime) < now) return false;
  return true;
};

// 格式化时间范围显示
const formatTimeRange = (row: any) => {
  if (!row.startTime && !row.endTime) return '永久生效';
  const start = row.startTime ? row.startTime : '无限制';
  const end = row.endTime ? row.endTime : '无限制';
  return `${start} ~ ${end}`;
};

onMounted(() => {
  getList();
});
</script>

<template>
  <Page title="通知公告" description="管理系统通知和公告信息">
    <!-- 搜索区域 -->
    <el-card class="mb-4" shadow="never">
      <el-form :inline="true" :model="formInline">
        <el-form-item label="公告标题">
          <el-input 
            v-model="formInline.noticeTitle" 
            placeholder="请输入公告标题" 
            clearable
            @keyup.enter="handleSearch"
          />
        </el-form-item>
        <el-form-item label="公告类型">
          <el-select v-model="formInline.noticeType" placeholder="请选择类型" clearable style="width: 140px">
            <el-option v-for="item in noticeTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="formInline.status" placeholder="请选择状态" clearable style="width: 120px">
            <el-option label="正常" value="1" />
            <el-option label="关闭" value="0" />
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
          <span>公告列表</span>
          <div>
            <el-button type="danger" :disabled="selectedIds.length === 0" @click="handleBatchDelete">
              批量删除
            </el-button>
            <el-button type="primary" @click="handleAdd">新增公告</el-button>
          </div>
        </div>
      </template>

      <!-- 表格 -->
      <el-table v-loading="loading" :data="tableData" stripe @selection-change="handleSelectionChange">
        <el-table-column type="selection" width="50" />
        <el-table-column prop="noticeTitle" label="公告标题" min-width="180" show-overflow-tooltip />
        <el-table-column prop="noticeType" label="公告类型" width="120" align="center">
          <template #default="{ row }">
            <el-tag :type="row.noticeType === '1' ? 'info' : 'warning'">
              {{ getTypeName(row.noticeType) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="生效时间" min-width="200">
          <template #default="{ row }">
            <div class="flex items-center">
              <span :class="isInEffectTime(row) ? 'text-green-600' : 'text-gray-400'">
                {{ formatTimeRange(row) }}
              </span>
              <el-tag v-if="!isInEffectTime(row)" type="info" size="small" class="ml-2">未生效</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag 
              :type="String(row.status) === '0' ? 'success' : 'info'" 
              @click="handleStatusChange(row)"
              style="cursor: pointer"
            >
              {{ String(row.status) === '0' ? '已发布' : '已下架' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createBy" label="创建者" width="120" />
        <el-table-column prop="createTime" label="创建时间" width="180" />
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
      width="700px"
      destroy-on-close
    >
      <el-form 
        ref="formRef"
        :model="form" 
        :rules="formRules" 
        label-width="100px"
      >
        <el-form-item label="公告标题" prop="noticeTitle">
          <el-input v-model="form.noticeTitle" placeholder="请输入公告标题" />
        </el-form-item>
        <el-form-item label="公告类型" prop="noticeType">
          <el-radio-group v-model="form.noticeType">
            <el-radio v-for="item in noticeTypeOptions" :key="item.value" :value="item.value">
              <span>{{ item.label }}</span>
              <span class="text-gray-400 text-xs ml-1">({{ item.description }})</span>
            </el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="生效时间">
          <div class="flex items-center w-full">
            <el-date-picker
              v-model="form.startTime"
              type="datetime"
              placeholder="开始时间"
              format="YYYY-MM-DD HH:mm:ss"
              value-format="YYYY-MM-DD HH:mm:ss"
              style="width: 200px"
            />
            <span class="mx-2">至</span>
            <el-date-picker
              v-model="form.endTime"
              type="datetime"
              placeholder="结束时间"
              format="YYYY-MM-DD HH:mm:ss"
              value-format="YYYY-MM-DD HH:mm:ss"
              style="width: 200px"
            />
          </div>
          <div class="text-gray-400 text-xs mt-1">不设置表示永久生效</div>
        </el-form-item>
        <el-form-item label="公告内容">
          <el-input 
            v-model="form.noticeContent" 
            type="textarea" 
            :rows="6" 
            placeholder="请输入公告内容" 
          />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio value="0">已发布</el-radio>
            <el-radio value="1">已下架</el-radio>
          </el-radio-group>
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
