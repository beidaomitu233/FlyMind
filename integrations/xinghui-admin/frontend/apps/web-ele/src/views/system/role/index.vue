<script lang="ts" setup>
import { reactive, ref, onMounted, nextTick } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Page } from '@vben/common-ui';
import { 
  getRoleList, 
  getRole,
  addRole, 
  updateRole, 
  removeRole, 
  changeRoleStatus,
  getMenuIdsByRoleId,
  assignMenusToRole
} from '#/api/system/role';
import { getMenuTree } from '#/api/system/menu';

// 搜索表单
const formInline = reactive({
  roleName: '',
  roleKey: '',
  status: '',
});

// 表格数据
const tableData = ref<any[]>([]);
const total = ref(0);
const loading = ref(false);
const queryParams = reactive({
  pageNum: 1,
  pageSize: 10,
});

// 弹窗控制
const dialogVisible = ref(false);
const dialogTitle = ref('新增角色');
const dialogLoading = ref(false);

// 菜单树相关
const menuTreeData = ref<any[]>([]);
const menuTreeRef = ref();
const menuExpand = ref(true);
const menuNodeAll = ref(false);

// 表单数据
const form = reactive({
  roleId: undefined as number | undefined,
  roleName: '',
  roleKey: '',
  roleSort: 0,
  status: 1,
  remark: '',
  menuIds: [] as number[],
});

const formRules = {
  roleName: [{ required: true, message: '请输入角色名称', trigger: 'blur' }],
  roleKey: [{ required: true, message: '请输入角色标识', trigger: 'blur' }],
};

const formRef = ref();

// 获取角色列表
const getList = async () => {
  loading.value = true;
  try {
    const res = await getRoleList({ ...queryParams, ...formInline });
    tableData.value = res.rows || res.records || [];
    total.value = Number(res.total) || 0;
  } catch (error) {
    console.error(error);
    ElMessage.error('获取角色列表失败');
  } finally {
    loading.value = false;
  }
};

// 获取菜单树
const loadMenuTree = async () => {
  try {
    const res = await getMenuTree({});
    menuTreeData.value = res.data || res || [];
  } catch (error) {
    console.error(error);
  }
};

// 搜索
const handleSearch = () => {
  queryParams.pageNum = 1;
  getList();
};

// 重置搜索
const handleReset = () => {
  formInline.roleName = '';
  formInline.roleKey = '';
  formInline.status = '';
  handleSearch();
};

// 重置表单
const resetForm = () => {
  form.roleId = undefined;
  form.roleName = '';
  form.roleKey = '';
  form.roleSort = 0;
  form.status = 1;
  form.remark = '';
  form.menuIds = [];
  menuExpand.value = true;
  menuNodeAll.value = false;
};

// 新增
const handleAdd = async () => {
  resetForm();
  await loadMenuTree();
  dialogTitle.value = '新增角色';
  dialogVisible.value = true;
  await nextTick();
  menuTreeRef.value?.setCheckedKeys([]);
};

// 编辑
const handleEdit = async (row: any) => {
  resetForm();
  await loadMenuTree();
  dialogTitle.value = '编辑角色';
  try {
    const res = await getRole(row.roleId);
    const data = res.data || res;
    Object.assign(form, {
      roleId: data.roleId,
      roleName: data.roleName,
      roleKey: data.roleKey,
      roleSort: data.roleSort,
      status: data.status,
      remark: data.remark,
    });
    
    // 获取已分配的菜单
    const menuRes = await getMenuIdsByRoleId(row.roleId);
    const menuIds = menuRes.data || menuRes || [];
    form.menuIds = menuIds;
    
    dialogVisible.value = true;
    await nextTick();
    menuTreeRef.value?.setCheckedKeys(menuIds);
  } catch (error) {
    ElMessage.error('获取角色信息失败');
  }
};

// 删除
const handleDelete = (row: any) => {
  ElMessageBox.confirm(`确定要删除角色"${row.roleName}"吗？`, '警告', {
    type: 'warning',
    confirmButtonText: '确定',
    cancelButtonText: '取消',
  }).then(async () => {
    try {
      await removeRole(row.roleId);
      ElMessage.success('删除成功');
      getList();
    } catch (error) {
      ElMessage.error('删除失败');
    }
  }).catch(() => {});
};

// 切换状态
const handleStatusChange = async (row: any) => {
  const newStatus = row.status === 1 ? 0 : 1;
  const statusText = newStatus === 1 ? '启用' : '停用';
  
  try {
    await ElMessageBox.confirm(`确定要${statusText}角色"${row.roleName}"吗？`, '提示', {
      type: 'warning',
    });
    await changeRoleStatus(row.roleId, newStatus);
    ElMessage.success(`${statusText}成功`);
    getList();
  } catch (error) {
    // 用户取消或请求失败
  }
};

// 获取选中的菜单ID
const getCheckedMenuIds = () => {
  const checkedKeys = menuTreeRef.value?.getCheckedKeys() || [];
  const halfCheckedKeys = menuTreeRef.value?.getHalfCheckedKeys() || [];
  return [...checkedKeys, ...halfCheckedKeys];
};

// 提交表单
const handleSubmit = async () => {
  try {
    await formRef.value?.validate();
    dialogLoading.value = true;
    
    const menuIds = getCheckedMenuIds();
    
    if (form.roleId) {
      await updateRole(form);
      await assignMenusToRole(form.roleId, menuIds);
      ElMessage.success('修改成功');
    } else {
      const res = await addRole(form);
      const roleId = res.data || res;
      if (roleId && menuIds.length > 0) {
        await assignMenusToRole(roleId, menuIds);
      }
      ElMessage.success('新增成功');
    }
    
    dialogVisible.value = false;
    getList();
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(form.roleId ? '修改失败' : '新增失败');
    }
  } finally {
    dialogLoading.value = false;
  }
};

// 分页变化
const handlePageChange = () => {
  getList();
};

// 树操作 - 展开/折叠
const handleTreeExpandChange = () => {
  const nodes = menuTreeRef.value?.store?.nodesMap || {};
  for (const node of Object.values(nodes) as any[]) {
    node.expanded = menuExpand.value;
  }
};

// 树操作 - 全选/全不选
const handleTreeCheckAllChange = () => {
  if (menuNodeAll.value) {
    menuTreeRef.value?.setCheckedNodes(menuTreeData.value);
  } else {
    menuTreeRef.value?.setCheckedKeys([]);
  }
};

onMounted(() => {
  getList();
});
</script>

<template>
  <Page title="角色管理" description="管理系统角色及其权限">
    <!-- 搜索区域 -->
    <el-card class="mb-4" shadow="never">
      <el-form :inline="true" :model="formInline">
        <el-form-item label="角色名称">
          <el-input 
            v-model="formInline.roleName" 
            placeholder="请输入角色名称" 
            clearable
            @keyup.enter="handleSearch"
          />
        </el-form-item>
        <el-form-item label="角色标识">
          <el-input 
            v-model="formInline.roleKey" 
            placeholder="请输入角色标识" 
            clearable
            @keyup.enter="handleSearch"
          />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="formInline.status" placeholder="请选择状态" clearable style="width: 120px">
            <el-option label="正常" value="1" />
            <el-option label="停用" value="0" />
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
          <span>角色列表</span>
          <el-button type="primary" @click="handleAdd">新增角色</el-button>
        </div>
      </template>

      <!-- 表格 -->
      <el-table v-loading="loading" :data="tableData" stripe>
        <el-table-column type="selection" width="50" />
        <el-table-column prop="roleName" label="角色名称" min-width="120" />
        <el-table-column prop="roleKey" label="角色标识" min-width="120" />
        <el-table-column prop="roleSort" label="排序" width="80" align="center" />
        <el-table-column prop="status" label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag 
              :type="row.status === 1 ? 'success' : 'danger'" 
              @click="handleStatusChange(row)"
              style="cursor: pointer"
            >
              {{ row.status === 1 ? '正常' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createTime" label="创建时间" width="180" />
        <el-table-column label="操作" width="180" fixed="right">
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
        label-width="100px"
      >
        <el-form-item label="角色名称" prop="roleName">
          <el-input v-model="form.roleName" placeholder="请输入角色名称" />
        </el-form-item>
        <el-form-item label="角色标识" prop="roleKey">
          <el-input v-model="form.roleKey" placeholder="请输入角色标识" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.roleSort" :min="0" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio :value="1">正常</el-radio>
            <el-radio :value="0">停用</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="菜单权限">
          <div class="w-full">
            <div class="mb-2">
              <el-checkbox v-model="menuExpand" @change="handleTreeExpandChange">展开/折叠</el-checkbox>
              <el-checkbox v-model="menuNodeAll" @change="handleTreeCheckAllChange">全选/全不选</el-checkbox>
            </div>
            <div class="border rounded p-2 max-h-64 overflow-auto">
              <el-tree
                ref="menuTreeRef"
                :data="menuTreeData"
                :props="{ label: 'menuName', children: 'children' }"
                show-checkbox
                node-key="menuId"
                :default-expand-all="true"
                :check-strictly="false"
              />
            </div>
          </div>
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
