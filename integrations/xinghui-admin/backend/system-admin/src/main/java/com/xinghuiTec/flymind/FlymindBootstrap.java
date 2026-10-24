package com.xinghuiTec.flymind;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import java.security.SecureRandom;

/** Explicit, one-time isolated deployment bootstrap. Never runs by default. */
@Component
@ConditionalOnProperty(name="flymind.bootstrap.enabled",havingValue="true")
public class FlymindBootstrap implements ApplicationRunner {
 private final JdbcTemplate db;private final PasswordEncoder encoder;private final String tenant;
 public FlymindBootstrap(JdbcTemplate db,PasswordEncoder encoder,@Value("${FLYMIND_APP_TENANT_ID}")String tenant){this.db=db;this.encoder=encoder;this.tenant=tenant;}
 private String required(String name){String v=System.getenv(name);if(v==null||v.isBlank())throw new IllegalStateException(name+" must be explicitly configured");return v;}
 private long id(){return new SecureRandom().nextLong()&Long.MAX_VALUE;}
 @Override @Transactional public void run(ApplicationArguments args){ initialize(required("FLYMIND_BOOTSTRAP_PHONE"),required("FLYMIND_BOOTSTRAP_PASSWORD")); }
 void initialize(String phone,String password){
  if(!phone.matches("1[3-9][0-9]{9}")||password.length()<12||password.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>72)throw new IllegalStateException("Bootstrap requires a valid phone and a password of 12 characters and at most 72 UTF-8 bytes");
  if(db.queryForObject("SELECT COUNT(*) FROM sys_user",Integer.class)!=0)throw new IllegalStateException("Bootstrap refuses a database that already contains accounts");
  if(db.queryForObject("SELECT COUNT(*) FROM sys_tenant WHERE tenant_id=?",Integer.class,tenant)==0)db.update("INSERT INTO sys_tenant(id,tenant_id,company_name,status) VALUES(?,?,?,'0')",id(),tenant,"FlyMind application");
  long user=id(),role=id();db.update("INSERT INTO sys_user(user_id,tenant_id,username,nickname,password,mobile,status,is_deleted) VALUES(?,?,?,?,?,?,1,0)",user,tenant,phone,"平台管理员",encoder.encode(password),phone);
  db.update("INSERT INTO sys_role(role_id,tenant_id,role_name,role_key,status,is_deleted) VALUES(?,?,?,'flymind-platform-admin',1,0)",role,tenant,"FlyMind平台管理员");
  db.update("INSERT INTO sys_user_role(user_id,role_id) VALUES(?,?)",user,role);
  long directory=90001L,users=90002L,teams=90003L,dashboard=90004L,overview=90005L;
  db.update("INSERT INTO sys_menu(menu_id,menu_name,parent_id,menu_type,path,status,visible,is_deleted) VALUES(?,? ,0,'M','flymind','0','0',0)",directory,"FlyMind管理");
  db.update("INSERT INTO sys_menu(menu_id,menu_name,parent_id,menu_type,path,component,status,visible,perms,is_deleted) VALUES(?,?,?,'C','users','system/user/index','0','0','system:user:list',0)",users,"用户管理",directory);
  db.update("INSERT INTO sys_menu(menu_id,menu_name,parent_id,menu_type,path,component,status,visible,perms,is_deleted) VALUES(?,?,?,'C','teams','system/team/index','0','0','flymind:team:list',0)",teams,"团队管理",directory);
  if(db.queryForObject("SELECT COUNT(*) FROM sys_menu WHERE menu_id=? AND parent_id=0 AND menu_type='M' AND path='dashboard' AND is_deleted=0",Integer.class,dashboard)==0)db.update("INSERT INTO sys_menu(menu_id,menu_name,parent_id,order_num,menu_type,path,status,visible,is_deleted) VALUES(?,?,0,-100,'M','dashboard','0','0',0)",dashboard,"数据看板");
  if(db.queryForObject("SELECT COUNT(*) FROM sys_menu WHERE menu_id=? AND parent_id=? AND menu_type='C' AND path='overview' AND component='dashboard/analytics/index' AND perms='flymind:dashboard:view' AND is_deleted=0",Integer.class,overview,dashboard)==0)db.update("INSERT INTO sys_menu(menu_id,menu_name,parent_id,order_num,menu_type,path,component,status,visible,perms,is_deleted) VALUES(?,?,?,0,'C','overview','dashboard/analytics/index','0','0','flymind:dashboard:view',0)",overview,"应用概览",dashboard);
  for(long menu:new long[]{directory,users,teams,dashboard,overview})db.update("INSERT INTO sys_role_menu(role_id,menu_id) VALUES(?,?)",role,menu);
  for(String perm:new String[]{"flymind:dashboard:view","system:user:list","system:user:query","system:user:add","system:user:edit","system:user:remove","system:role:list","system:role:query","system:role:add","system:role:edit","system:role:remove","flymind:team:list","flymind:team:query","flymind:team:edit"}){
   long menu=id();db.update("INSERT INTO sys_menu(menu_id,menu_name,menu_type,perms,status,is_deleted) VALUES(?,?,'F',?,'0',0)",menu,perm,perm);db.update("INSERT INTO sys_role_menu(role_id,menu_id) VALUES(?,?)",role,menu);
  }
 }
}
