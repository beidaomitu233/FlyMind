import assert from 'node:assert/strict';
import test from 'node:test';

import { restoreUserSession } from './session-info.ts';

test('refresh replaces persisted access codes after a role permission changes', async () => {
  let accessCodes = ['system:user:edit'];
  let userInfo;
  const apply = (permissions) => restoreUserSession(
    async () => ({ userId: '42', roles: ['operator'], permissions }),
    (info) => { userInfo = info; },
    (codes) => { accessCodes = codes; },
  );

  await apply(['system:user:list']);
  assert.deepEqual(accessCodes, ['system:user:list']);
  assert.deepEqual(userInfo.permissions, accessCodes);

  await apply([]);
  assert.deepEqual(accessCodes, []);
});
