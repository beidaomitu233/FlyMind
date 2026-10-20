-- New controlled deployment: app accounts must not have duplicate phone identities.
CREATE UNIQUE INDEX uk_flymind_tenant_mobile ON sys_user(tenant_id,mobile);
