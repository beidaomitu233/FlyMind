<script lang="ts" setup>
import { reactive, ref, onMounted, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Page } from '@vben/common-ui';
import { 
   
  getMenu,
  getMenuTree,
  addMenu, 
  updateMenu, 
  removeMenu 
} from '#/api/system/menu';

// 搜索表单
const formInline = reactive({
  menuName: '',
  status: '',
});

// 表格数据
const tableData = ref<any[]>([]);
const loading = ref(false);

// 弹窗控制
const dialogVisible = ref(false);
const dialogTitle = ref('新增菜单');
const dialogLoading = ref(false);

// 菜单树（用于选择父级）
const menuTreeData = ref<any[]>([]);

// 表单数据
const form = reactive({
  menuId: undefined as number | undefined,
  parentId: 0,
  menuName: '',
  menuType: 'M',
  orderNum: 0,
  icon: '',
  path: '',
  component: '',
  perms: '',
  visible: '0',
  status: '0',
  isFrame: '1',
  isCache: '0',
  remark: '',
});

const formRules = {
  menuName: [{ required: true, message: '请输入菜单名称', trigger: 'blur' }],
  orderNum: [{ required: true, message: '请输入显示顺序', trigger: 'blur' }],
};

const formRef = ref();

// 菜单类型选项
const menuTypeOptions = [
  { label: '目录', value: 'M' },
  { label: '菜单', value: 'C' },
  { label: '按钮', value: 'F' },
];

// 是否显示路由配置
const showRoutConfig = computed(() => form.menuType !== 'F');
// 是否显示组件配置
const showComponent = computed(() => form.menuType === 'C');
// 是否显示权限配置
const showPerms = computed(() => form.menuType !== 'M');

// 获取菜单列表
const getList = async () => {
  loading.value = true;
  try {
    const res = await getMenuTree(formInline);
    tableData.value = res.data || res || [];
  } catch (error) {
    console.error(error);
    ElMessage.error('获取菜单列表失败');
  } finally {
    loading.value = false;
  }
};

// 获取菜单树
const loadMenuTree = async () => {
  try {
    const res = await getMenuTree({});
    menuTreeData.value = [
      { menuId: 0, menuName: '主类目', children: res.data || res || [] }
    ];
  } catch (error) {
    console.error(error);
  }
};

// 搜索
const handleSearch = () => {
  getList();
};

// 重置搜索
const handleReset = () => {
  formInline.menuName = '';
  formInline.status = '';
  handleSearch();
};

// 重置表单
const resetForm = () => {
  form.menuId = undefined;
  form.parentId = 0;
  form.menuName = '';
  form.menuType = 'M';
  form.orderNum = 0;
  form.icon = '';
  form.path = '';
  form.component = '';
  form.perms = '';
  form.visible = '0';
  form.status = '0';
  form.isFrame = '1';
  form.isCache = '0';
  form.remark = '';
};

// 新增
const handleAdd = (row?: any) => {
  resetForm();
  loadMenuTree();
  dialogTitle.value = '新增菜单';
  if (row) {
    form.parentId = row.menuId;
  }
  dialogVisible.value = true;
};

// 编辑
const handleEdit = async (row: any) => {
  resetForm();
  loadMenuTree();
  dialogTitle.value = '编辑菜单';
  try {
    const res = await getMenu(row.menuId);
    const data = res.data || res;
    Object.assign(form, {
      menuId: data.menuId,
      parentId: data.parentId,
      menuName: data.menuName,
      menuType: data.menuType,
      orderNum: data.orderNum,
      icon: data.icon,
      path: data.path,
      component: data.component,
      perms: data.perms,
      visible: data.visible,
      status: data.status,
      isFrame: data.isFrame,
      isCache: data.isCache,
      remark: data.remark,
    });
    dialogVisible.value = true;
  } catch (error) {
    ElMessage.error('获取菜单信息失败');
  }
};

// 删除
const handleDelete = (row: any) => {
  ElMessageBox.confirm(`确定要删除菜单"${row.menuName}"吗？`, '警告', {
    type: 'warning',
    confirmButtonText: '确定',
    cancelButtonText: '取消',
  }).then(async () => {
    try {
      await removeMenu(row.menuId);
      ElMessage.success('删除成功');
      getList();
    } catch (error) {
      ElMessage.error('删除失败');
    }
  }).catch(() => {});
};

// 提交表单
const handleSubmit = async () => {
  try {
    await formRef.value?.validate();
    dialogLoading.value = true;
    
    if (form.menuId) {
      await updateMenu(form);
      ElMessage.success('修改成功');
    } else {
      await addMenu(form);
      ElMessage.success('新增成功');
    }
    
    dialogVisible.value = false;
    getList();
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(form.menuId ? '修改失败' : '新增失败');
    }
  } finally {
    dialogLoading.value = false;
  }
};

// 展开/收起
const toggleExpand = ref(true);
const handleToggleExpand = () => {
  toggleExpand.value = !toggleExpand.value;
};

onMounted(() => {
  getList();
});
</script>

<template>
  <Page title="菜单管理" description="配置系统菜单及权限">
    <!-- 搜索区域 -->
    <el-card class="mb-4" shadow="never">
      <el-form :inline="true" :model="formInline">
        <el-form-item label="菜单名称">
          <el-input 
            v-model="formInline.menuName" 
            placeholder="请输入菜单名称" 
            clearable
            @keyup.enter="handleSearch"
          />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="formInline.status" placeholder="请选择状态" clearable style="width: 120px">
            <el-option label="正常" value="0" />
            <el-option label="停用" value="1" />
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
          <span>菜单列表</span>
          <div>
            <el-button @click="handleToggleExpand">
              {{ toggleExpand ? '收起' : '展开' }}
            </el-button>
            <el-button type="primary" @click="handleAdd()">新增菜单</el-button>
          </div>
        </div>
      </template>

      <!-- 表格 -->
      <el-table 
        v-loading="loading" 
        :data="tableData" 
        row-key="menuId"
        :default-expand-all="toggleExpand"
        :tree-props="{ children: 'children' }"
      >
        <el-table-column prop="menuName" label="菜单名称" min-width="180" />
        <el-table-column prop="icon" label="图标" width="80" align="center">
          <template #default="{ row }">
            <span v-if="row.icon">{{ row.icon }}</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="orderNum" label="排序" width="80" align="center" />
        <el-table-column prop="perms" label="权限标识" min-width="150" />
        <el-table-column prop="component" label="组件路径" min-width="150" />
        <el-table-column prop="status" label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === '0' ? 'success' : 'danger'">
              {{ row.status === '0' ? '正常' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createTime" label="创建时间" width="180" />
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="handleEdit(row)">
              编辑
            </el-button>
            <el-button type="primary" link size="small" @click="handleAdd(row)">
              新增
            </el-button>
            <el-button type="danger" link size="small" @click="handleDelete(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新增/编辑弹窗 -->
    <el-dialog 
      v-model="dialogVisible" 
      :title="dialogTitle" 
      width="680px"
      destroy-on-close
    >
      <el-form 
        ref="formRef"
        :model="form" 
        :rules="formRules" 
        label-width="100px"
      >
        <el-row :gutter="20">
          <el-col :span="24">
            <el-form-item label="上级菜单">
              <el-tree-select
                v-model="form.parentId"
                :data="menuTreeData"
                :props="{ label: 'menuName', children: 'children' }"
                node-key="menuId"
                check-strictly
                placeholder="请选择上级菜单"
                clearable
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="菜单类型">
              <el-radio-group v-model="form.menuType">
                <el-radio v-for="item in menuTypeOptions" :key="item.value" :value="item.value">
                  {{ item.label }}
                </el-radio>
              </el-radio-group>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="菜单名称" prop="menuName">
              <el-input v-model="form.menuName" placeholder="请输入菜单名称" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="显示排序" prop="orderNum">
              <el-input-number v-model="form.orderNum" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12" v-if="showRoutConfig">
            <el-form-item label="路由地址">
              <el-input v-model="form.path" placeholder="请输入路由地址" />
            </el-form-item>
          </el-col>
          <el-col :span="12" v-if="showComponent">
            <el-form-item label="组件路径">
              <el-input v-model="form.component" placeholder="请输入组件路径" />
            </el-form-item>
          </el-col>
          <el-col :span="12" v-if="showPerms">
            <el-form-item label="权限标识">
              <el-input v-model="form.perms" placeholder="请输入权限标识" />
            </el-form-item>
          </el-col>
          <el-col :span="12" v-if="showRoutConfig">
            <el-form-item label="图标">
              <el-input v-model="form.icon" placeholder="请输入图标" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="显示状态">
              <el-radio-group v-model="form.visible">
                <el-radio value="0">显示</el-radio>
                <el-radio value="1">隐藏</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="菜单状态">
              <el-radio-group v-model="form.status">
                <el-radio value="0">正常</el-radio>
                <el-radio value="1">停用</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-col>
        </el-row>
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
