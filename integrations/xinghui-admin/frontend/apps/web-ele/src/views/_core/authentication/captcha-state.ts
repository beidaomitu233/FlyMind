interface CaptchaResult {
  enabled: boolean;
  img: string;
  uuid: string;
}

export type CaptchaState =
  | { enabled: boolean; img: string; status: 'ready'; uuid: string }
  | { status: 'error' | 'loading' };

/** 未确认开关时返回 null，调用方必须停止登录。 */
export function getLoginCaptchaFields(state: CaptchaState, code: string) {
  if (state.status !== 'ready') return null;
  return state.enabled ? { code, uuid: state.uuid } : {};
}

/** 仅在服务端明确返回开关状态后允许登录，忽略过期的并发响应。 */
export function createCaptchaController(
  load: () => Promise<CaptchaResult>,
  onChange: (state: CaptchaState) => void,
) {
  let requestId = 0;

  async function refresh() {
    const currentId = ++requestId;
    onChange({ status: 'loading' });
    try {
      const result = await load();
      if (currentId !== requestId) return;
      if (
        typeof result?.enabled !== 'boolean' ||
        (result.enabled && (!result.img || !result.uuid))
      ) {
        throw new Error('验证码响应不完整');
      }
      onChange({ status: 'ready', ...result });
    } catch {
      if (currentId === requestId) onChange({ status: 'error' });
    }
  }

  return { refresh };
}
