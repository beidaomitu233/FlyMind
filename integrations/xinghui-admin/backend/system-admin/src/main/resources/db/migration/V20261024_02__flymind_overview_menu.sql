-- Fixed ids are reserved by FlyMind; a different existing row deliberately fails its PK.
INSERT INTO sys_menu(menu_id,menu_name,parent_id,order_num,menu_type,path,status,visible,is_deleted)
SELECT 90004,'数据看板',0,-100,'M','dashboard','0','0',0
WHERE NOT EXISTS(SELECT 1 FROM sys_menu WHERE menu_id=90004 AND parent_id=0 AND menu_type='M' AND path='dashboard' AND is_deleted=0);
INSERT INTO sys_menu(menu_id,menu_name,parent_id,order_num,menu_type,path,component,status,visible,perms,is_deleted)
SELECT 90005,'应用概览',90004,0,'C','overview','dashboard/analytics/index','0','0','flymind:dashboard:view',0
WHERE NOT EXISTS(SELECT 1 FROM sys_menu WHERE menu_id=90005 AND parent_id=90004 AND menu_type='C' AND path='overview' AND component='dashboard/analytics/index' AND perms='flymind:dashboard:view' AND is_deleted=0);
INSERT INTO sys_role_menu(role_id,menu_id)
SELECT r.role_id,m.menu_id FROM sys_role r JOIN sys_menu m ON m.menu_id IN (90004,90005)
WHERE r.role_key='flymind-platform-admin' AND r.is_deleted=0
AND NOT EXISTS(SELECT 1 FROM sys_role_menu rm WHERE rm.role_id=r.role_id AND rm.menu_id=m.menu_id);
