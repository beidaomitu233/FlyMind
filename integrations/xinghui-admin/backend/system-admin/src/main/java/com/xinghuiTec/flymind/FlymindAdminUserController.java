package com.xinghuiTec.flymind;
import org.springframework.web.bind.annotation.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.*;
import org.springframework.transaction.annotation.Transactional;
import java.security.SecureRandom;
import java.nio.charset.StandardCharsets;
import java.util.*;
@RestController
@RequestMapping("/admin/flymind/users")
@Transactional
public class FlymindAdminUserController {
 private final JdbcTemplate db;private final PasswordEncoder encoder;private final String tenant;private final com.xinghuiTec.utils.RedisCacheUtils adminSessions;
 public FlymindAdminUserController(JdbcTemplate db,PasswordEncoder encoder,@Value("${FLYMIND_APP_TENANT_ID}")String tenant,com.xinghuiTec.utils.RedisCacheUtils adminSessions){this.db=db;this.encoder=encoder;this.tenant=tenant;this.adminSessions=adminSessions;}
 private ResponseEntity<Object> ok(Object data){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("code",200,"message","成功","data",data));}
 private FlymindException bad(){return new FlymindException(400,"INVALID_INPUT","用户参数不合法");}
 @GetMapping @PreAuthorize("hasAuthority('system:user:list')") public ResponseEntity<Object> list(){return ok(db.query("SELECT user_id,COALESCE(NULLIF(nickname,''),username),mobile,status FROM sys_user WHERE tenant_id=? AND is_deleted=0 ORDER BY user_id LIMIT 500",(r,n)->Map.of("id",r.getString(1),"name",r.getString(2),"phone",r.getString(3),"status",r.getInt(4)),tenant));}
 @PostMapping @PreAuthorize("hasAuthority('system:user:add')") public ResponseEntity<Object> create(@RequestBody Map<String,Object>b){
  if(!b.keySet().equals(Set.of("phone","name","password"))||!(b.get("phone")instanceof String phone)||!(b.get("name")instanceof String name)||!(b.get("password")instanceof String password))throw bad();
  if(!phone.matches("1[3-9][0-9]{9}")||name.trim().isEmpty()||name.trim().length()>30||password.length()<12||password.getBytes(StandardCharsets.UTF_8).length>72)throw bad();
  if(db.queryForObject("SELECT COUNT(*) FROM sys_user WHERE mobile=? AND tenant_id=?",Integer.class,phone,tenant)>0)throw new FlymindException(409,"ACCOUNT_EXISTS","账号已存在");
  String id=Long.toString(new SecureRandom().nextLong()&Long.MAX_VALUE);
  db.update("INSERT INTO sys_user(user_id,tenant_id,username,nickname,password,mobile,status,is_deleted) VALUES(?,?,?,?,?,?,1,0)",id,tenant,"fm_"+phone,name.trim(),encoder.encode(password),phone);return ok(Map.of("id",id,"name",name.trim(),"phone",phone,"status",1));
 }
 @PatchMapping("/{id}") @PreAuthorize("hasAuthority('system:user:edit')") public ResponseEntity<Object> status(@PathVariable String id,@RequestBody Map<String,Object>b){id=accountId(id);if(!b.keySet().equals(Set.of("status"))||!(b.get("status")instanceof Number n)||(n.doubleValue()!=0&&n.doubleValue()!=1))throw bad();if(db.update("UPDATE sys_user SET status=? WHERE user_id=? AND tenant_id=? AND is_deleted=0",n.intValue(),id,tenant)!=1)throw new FlymindException(404,"ACCOUNT_NOT_FOUND","账号不存在");if(n.intValue()==0)revokeSessions(id);return ok(Map.of("success",true));}
 private String accountId(String value){try{long id=Long.parseLong(value);if(id<=0||!Long.toString(id).equals(value))throw bad();return value;}catch(NumberFormatException e){throw bad();}}
 private void revokeSessions(String id){
  db.update("UPDATE app_flymind_oauth_grant SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL",System.currentTimeMillis(),id);
  db.update("UPDATE app_flymind_session SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL",System.currentTimeMillis(),id);
  try{adminSessions.deleteObject(com.xinghuiTec.constants.RedisConstants.ADMIN_LOGIN_PREFIX+id);}
  catch(RuntimeException error){throw new FlymindException(503,"IDENTITY_UNAVAILABLE","身份服务暂时不可用，操作未完成");}
 }
 @PostMapping("/{id}/password") @PreAuthorize("hasAuthority('system:user:edit')") public ResponseEntity<Object> resetPassword(@PathVariable String id,@RequestBody Map<String,Object>b){id=accountId(id);
  if(!b.keySet().equals(Set.of("password"))||!(b.get("password")instanceof String password)||password.length()<12||password.getBytes(StandardCharsets.UTF_8).length>72)throw bad();
  if(db.update("UPDATE sys_user SET password=? WHERE user_id=? AND tenant_id=? AND is_deleted=0",encoder.encode(password),id,tenant)!=1)throw new FlymindException(404,"ACCOUNT_NOT_FOUND","账号不存在");
  revokeSessions(id);return ok(Map.of("success",true));
 }
}
