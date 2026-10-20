<script lang="ts" setup>
import type { VbenFormSchema } from '@vben/common-ui';

import type { CaptchaState } from './captcha-state';

import type { AuthApi } from '#/api/core/auth';

import { computed, onMounted, ref } from 'vue';

import { AuthenticationLogin, z } from '@vben/common-ui';

import { getCaptchaApi } from '#/api/core/auth';
import { useAuthStore } from '#/store';

import {
  createCaptchaController,
  getLoginCaptchaFields,
} from './captcha-state';

defineOptions({ name: 'Login' });

const authStore = useAuthStore();
const captchaState = ref<CaptchaState>({ status: 'loading' });
const captchaEnabled = computed(
  () => captchaState.value.status === 'ready' && captchaState.value.enabled,
);
const captchaImage = computed(() =>
  captchaState.value.status === 'ready' ? captchaState.value.img : '',
);
const captchaController = createCaptchaController(getCaptchaApi, (state) => {
  captchaState.value = state;
});

async function refreshCaptcha() {
  await captchaController.refresh();
}

async function submit(values: Record<string, unknown>) {
  const captcha = captchaState.value;
  const captchaFields = getLoginCaptchaFields(
    captcha,
    String(values.code ?? ''),
  );
  if (captchaFields === null) return;
  try {
    await authStore.authLogin({
      phone: String(values.phone ?? ''),
      password: String(values.password ?? ''),
      ...captchaFields,
    } satisfies AuthApi.LoginParams);
  } catch {
    if (captcha.status === 'ready' && captcha.enabled) await refreshCaptcha();
  }
}

const formSchema = computed((): VbenFormSchema[] => [
  {
    component: 'VbenInput',
    componentProps: { placeholder: '请输入11位手机号' },
    fieldName: 'phone',
    label: '手机号',
    rules: z.string().regex(/^1[3-9]\d{9}$/, '请输入正确的手机号'),
  },
  {
    component: 'VbenInputPassword',
    componentProps: { placeholder: '请输入密码' },
    fieldName: 'password',
    label: '密码',
    rules: z.string().min(1, '请输入密码'),
  },
  ...(captchaEnabled.value
    ? [
        {
          component: 'VbenInput' as const,
          componentProps: { placeholder: '请输入图片验证码' },
          fieldName: 'code',
          label: '验证码',
          rules: z.string().min(1, '请输入验证码'),
        },
      ]
    : []),
]);

onMounted(() => {
  refreshCaptcha();
});
</script>

<template>
  <AuthenticationLogin
    :form-schema="formSchema"
    :loading="authStore.loginLoading"
    :submit-disabled="captchaState.status !== 'ready'"
    :show-code-login="false"
    :show-qrcode-login="false"
    :show-register="false"
    :show-remember-me="true"
    :show-forget-password="false"
    :show-third-party-login="false"
    @submit="submit"
  >
    <template #third-party-login>
      <p v-if="captchaState.status === 'loading'" class="mt-3" role="status">
        正在获取验证码配置…
      </p>
      <div
        v-else-if="captchaState.status === 'error'"
        class="mt-3"
        role="alert"
      >
        <span>验证码加载失败，请重试。</span>
        <button class="ml-2 underline" type="button" @click="refreshCaptcha">
          重试
        </button>
      </div>
      <button
        v-else-if="captchaEnabled"
        class="mt-3 flex items-center gap-2"
        type="button"
        @click="refreshCaptcha"
      >
        <img
          :src="`data:image/png;base64,${captchaImage}`"
          alt="验证码，点击刷新"
        />
        <span>换一张</span>
      </button>
    </template>
  </AuthenticationLogin>
</template>
