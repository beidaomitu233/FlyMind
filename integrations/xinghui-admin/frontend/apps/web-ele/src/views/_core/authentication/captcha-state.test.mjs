import assert from 'node:assert/strict';
import test from 'node:test';

import { createCaptchaController, getLoginCaptchaFields } from './captcha-state.ts';

test('failed initial load blocks login until retry confirms enabled captcha', async () => {
  const states = [];
  let attempts = 0;
  const controller = createCaptchaController(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('network unavailable');
    return { enabled: true, img: 'image', uuid: 'challenge-1' };
  }, (state) => states.push(state));

  await controller.refresh();
  assert.deepEqual(states.map((state) => state.status), ['loading', 'error']);
  assert.equal(getLoginCaptchaFields(states.at(-1), '1234'), null);

  await controller.refresh();
  assert.deepEqual(states.at(-1), {
    status: 'ready', enabled: true, img: 'image', uuid: 'challenge-1',
  });
  assert.deepEqual(getLoginCaptchaFields(states.at(-1), '1234'), {
    code: '1234', uuid: 'challenge-1',
  });
});

test('retry may confirm captcha is disabled', async () => {
  let attempts = 0;
  let state;
  const controller = createCaptchaController(async () => {
    if (++attempts === 1) throw new Error('timeout');
    return { enabled: false, img: '', uuid: '' };
  }, (next) => { state = next; });

  await controller.refresh();
  assert.equal(state.status, 'error');
  assert.equal(getLoginCaptchaFields(state, ''), null);
  await controller.refresh();
  assert.deepEqual(state, { status: 'ready', enabled: false, img: '', uuid: '' });
  assert.deepEqual(getLoginCaptchaFields(state, ''), {});
});

test('incomplete enabled captcha remains blocked', async () => {
  let state;
  const controller = createCaptchaController(
    async () => ({ enabled: true, img: '', uuid: '' }),
    (next) => { state = next; },
  );
  await controller.refresh();
  assert.equal(state.status, 'error');
  assert.equal(getLoginCaptchaFields(state, '1234'), null);
});
