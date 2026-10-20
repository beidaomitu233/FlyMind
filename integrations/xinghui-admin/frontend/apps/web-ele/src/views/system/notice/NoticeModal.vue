<script lang="ts" setup>
import { ref, reactive } from 'vue';
import { ElMessage } from 'element-plus';
import { addNotice, updateNotice, type NoticeInfo } from '#/api/system/notice';

const visible = ref(false);
const title = ref('新增通知');
const loading = ref(false);
const formRef = ref();

const formData = reactive<Partial<NoticeInfo>>({
  noticeTitle: '',
  noticeType: '1',
  noticeContent: '',
  status: '0',
  remark: '',
});

const rules = {
  noticeTitle: [{ required: true, message: '请输入通知标题', trigger: 'blur' }],
  noticeType: [{ required: true, message: '请选择通知类型', trigger: 'change' }],
  status: [{ required: true, message: '请选择状态', trigger: 'change' }],
};

const emit = defineEmits(['success']);

/**
 * 初始化并打开弹窗
 */
function open(record?: NoticeInfo) {
  visible.value = true;
  if (record) {
    title.value = '修改通知';
    Object.assign(formData, record);
  } else {
    title.value = '新增通知';
    resetForm();
  }
}

/**
 * 重置表单
 */
function resetForm() {
  Object.assign(formData, {
    noticeId: undefined,
    noticeTitle: '',
    noticeType: '1',
    noticeContent: '',
    status: '0',
    remark: '',
  });
  if (formRef.value) {
    formRef.value.clearValidate();
  }
}

/**
 * 提交表单
 */
async function handleSubmit() {
  try {
    await formRef.value.validate();
    loading.value = true;
    
    if (formData.noticeId) {
      await updateNotice(formData);
      ElMessage.success('修改成功');
    } else {
      await addNotice(formData);
      ElMessage.success('新增成功');
    }
    
    visible.value = false;
    emit('success');
  } catch (error) {
    console.error(error);
  } finally {
    loading.value = false;
  }
}

defineExpose({ open });
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="600px"
    append-to-body
    destroy-on-close
  >
    <el-form
      ref="formRef"
      :model="formData"
      :rules="rules"
      label-width="100px"
    >
      <el-form-item label="通知标题" prop="noticeTitle">
        <el-input v-model="formData.noticeTitle" placeholder="请输入通知标题" />
      </el-form-item>
      
      <el-form-item label="通知类型" prop="noticeType">
        <el-select v-model="formData.noticeType" placeholder="请选择类型">
          <el-option label="通知" value="1" />
          <el-option label="公告" value="2" />
        </el-select>
      </el-form-item>
      
      <el-form-item label="状态" prop="status">
        <el-radio-group v-model="formData.status">
          <el-radio value="0">正常</el-radio>
          <el-radio value="1">关闭</el-radio>
        </el-radio-group>
      </el-form-item>
      
      <el-form-item label="通知内容" prop="noticeContent">
        <el-input
          v-model="formData.noticeContent"
          type="textarea"
          :rows="4"
          placeholder="请输入内容"
        />
      </el-form-item>
      
      <el-form-item label="备注" prop="remark">
        <el-input v-model="formData.remark" type="textarea" placeholder="请输入备注" />
      </el-form-item>
    </el-form>
    
    <template #footer>
      <div class="dialog-footer">
        <el-button @click="visible = false">取 消</el-button>
        <el-button type="primary" :loading="loading" @click="handleSubmit">确 定</el-button>
      </div>
    </template>
  </el-dialog>
</template>
