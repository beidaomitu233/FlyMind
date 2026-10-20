<script lang="ts" setup>
import { reactive, ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Page } from '@vben/common-ui';
import { 
  getFileList, 
  uploadFile,
  removeFile,
  removeBatchFile,
  downloadFile
} from '#/api/system/file';

// 搜索表单
const formInline = reactive({
  originalName: '',
  ext: '',
});

// 表格数据
const tableData = ref<any[]>([]);
const total = ref(0);
const loading = ref(false);
const selectedIds = ref<string[]>([]);
const queryParams = reactive({
  pageNum: 1,
  pageSize: 10,
});

// 上传
const uploading = ref(false);

// 获取文件列表
const getList = async () => {
  loading.value = true;
  try {
    const res = await getFileList({ ...queryParams, ...formInline });
    tableData.value = res.rows || res.records || [];
    total.value = Number(res.total) || 0;
  } catch (error) {
    console.error(error);
    ElMessage.error('获取文件列表失败');
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
  formInline.originalName = '';
  formInline.ext = '';
  handleSearch();
};

// 上传文件
const handleUpload = async (options: any) => {
  uploading.value = true;
  try {
    await uploadFile(options.file);
    ElMessage.success('上传成功');
    getList();
  } catch (error) {
    ElMessage.error('上传失败');
  } finally {
    uploading.value = false;
  }
};

// 删除 - 使用id字段，转为String作为fileId传递
const handleDelete = (row: any) => {
  ElMessageBox.confirm(`确定要删除文件"${row.originalName || row.filename}"吗？`, '警告', {
    type: 'warning',
    confirmButtonText: '确定',
    cancelButtonText: '取消',
  }).then(async () => {
    try {
      // 后端返回的是id字段，需要转为String作为fileId
      await removeFile(String(row.id));
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
    ElMessage.warning('请选择要删除的文件');
    return;
  }
  ElMessageBox.confirm(`确定要删除选中的${selectedIds.value.length}个文件吗？`, '警告', {
    type: 'warning',
    confirmButtonText: '确定',
    cancelButtonText: '取消',
  }).then(async () => {
    try {
      await removeBatchFile(selectedIds.value);
      ElMessage.success('批量删除成功');
      selectedIds.value = [];
      getList();
    } catch (error) {
      ElMessage.error('批量删除失败');
    }
  }).catch(() => {});
};

// 下载 - 使用id字段，转为String作为fileId传递
const handleDownload = async (row: any) => {
  try {
    // 后端返回的是id字段，需要转为String作为fileId
    const res = await downloadFile(String(row.id));
    const blob = new Blob([res as any]);
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = row.originalName || row.filename;
    link.click();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    ElMessage.error('下载失败');
  }
};

// 选择变化 - 使用id字段，存储为String
const handleSelectionChange = (selection: any[]) => {
  selectedIds.value = selection.map(item => String(item.id));
};

// 分页变化
const handlePageChange = () => {
  getList();
};

// 格式化文件大小
const formatFileSize = (bytes: number) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let size = bytes;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(2)} ${units[unitIndex]}`;
};

// 获取文件类型图标
const getFileIcon = (ext: string) => {
  const iconMap: Record<string, string> = {
    'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'webp': '🖼️',
    'mp4': '🎬', 'avi': '🎬', 'mov': '🎬', 'mkv': '🎬',
    'mp3': '🎵', 'wav': '🎵', 'flac': '🎵',
    'pdf': '📑',
    'doc': '📝', 'docx': '📝',
    'xls': '📊', 'xlsx': '📊',
    'zip': '📦', 'rar': '📦', '7z': '📦',
    'default': '📄',
  };
  return iconMap[ext?.toLowerCase()] || iconMap.default;
};

onMounted(() => {
  getList();
});
</script>

<template>
  <Page title="文件管理" description="管理系统上传的文件">
    <!-- 搜索区域 -->
    <el-card class="mb-4" shadow="never">
      <el-form :inline="true" :model="formInline">
        <el-form-item label="文件名">
          <el-input 
            v-model="formInline.originalName" 
            placeholder="请输入文件名" 
            clearable
            @keyup.enter="handleSearch"
          />
        </el-form-item>
        <el-form-item label="文件类型">
          <el-select v-model="formInline.ext" placeholder="请选择类型" clearable style="width: 120px">
            <el-option label="PDF" value="pdf" />
            <el-option label="Word" value="docx" />
            <el-option label="Excel" value="xlsx" />
            <el-option label="图片" value="image" />
            <el-option label="视频" value="video" />
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
          <span>文件列表</span>
          <div>
            <el-button type="danger" :disabled="selectedIds.length === 0" @click="handleBatchDelete">
              批量删除
            </el-button>
            <el-upload
              :show-file-list="false"
              :http-request="handleUpload"
              class="inline-block ml-2"
            >
              <el-button type="primary" :loading="uploading">上传文件</el-button>
            </el-upload>
          </div>
        </div>
      </template>

      <!-- 表格 -->
      <el-table v-loading="loading" :data="tableData" stripe @selection-change="handleSelectionChange">
        <el-table-column type="selection" width="50" />
        <el-table-column prop="originalName" label="文件名" min-width="250">
          <template #default="{ row }">
            <span>{{ getFileIcon(row.ext) }} {{ row.originalName || row.filename }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="ext" label="类型" width="80" align="center">
          <template #default="{ row }">
            <el-tag size="small">{{ row.ext?.toUpperCase() }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="size" label="大小" width="120">
          <template #default="{ row }">
            {{ formatFileSize(row.size) }}
          </template>
        </el-table-column>
        <el-table-column prop="createTime" label="上传时间" width="180" />
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="handleDownload(row)">
              下载
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
  </Page>
</template>

<style scoped>
.el-card {
  border-radius: 8px;
}
</style>
