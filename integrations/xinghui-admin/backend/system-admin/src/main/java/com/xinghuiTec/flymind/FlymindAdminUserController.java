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
 private final JdbcTemplate db;private final PasswordEncoder encoder;private final String tenant;
 public FlymindAdminUserController(JdbcTemplate db,PasswordEncoder encoder,@Value("${FLYMIND_APP_TENANT_ID}")String tenant){this.db=db;this.encoder=encoder;this.tenant=tenant;}
 private ResponseEntity<Object> ok(Object data){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("code",200,"message","成功","data",data));}
 private FlymindException bad(){return new FlymindException(400,"INVALID_INPUT","用户参数不合法");}
 @GetMapping @PreAuthorize("hasAuthority('system:user:list')") public ResponseEntity<Object> list(){return ok(db.query("SELECT u.user_id,COALESCE(NULLIF(u.nickname,''),u.username),u.mobile,a.status FROM sys_user u JOIN app_flymind_account a ON a.user_id=u.user_id WHERE u.tenant_id=? AND u.is_deleted=0 ORDER BY u.user_id LIMIT 500",(r,n)->Map.of("id",r.getString(1),"name",r.getString(2),"phone",r.getString(3),"status",r.getInt(4),"userCode",FlymindUserDirectory.ensure(db,r.getString(1),System.currentTimeMillis())),tenant));}
 @PostMapping @PreAuthorize("hasAuthority('system:user:add')") public ResponseEntity<Object> create(@RequestBody Map<String,Object>b){
  if(!b.keySet().equals(Set.of("phone","name","password"))||!(b.get("phone")instanceof String phone)||!(b.get("name")instanceof String name)||!(b.get("password")instanceof String password))throw bad();
  if(!phone.matches("1[3-9][0-9]{9}")||name.trim().isEmpty()||name.trim().length()>30||password.codePointCount(0,password.length())<6||password.isBlank()||password.getBytes(StandardCharsets.UTF_8).length>72)throw bad();
  List<String> existing=db.query("SELECT user_id FROM sys_user WHERE mobile=? AND tenant_id=? AND is_deleted=0 FOR UPDATE",(r,n)->r.getString(1),phone,tenant);
  String id=existing.isEmpty()?Long.toString(new SecureRandom().nextLong()&Long.MAX_VALUE):existing.get(0);
  if(!existing.isEmpty()&&db.queryForObject("SELECT COUNT(*) FROM app_flymind_account WHERE user_id=?",Integer.class,id)>0)throw new FlymindException(409,"ACCOUNT_EXISTS","前台账号已存在");
  if(existing.isEmpty())db.update("INSERT INTO sys_user(user_id,tenant_id,username,nickname,password,mobile,status,is_deleted) VALUES(?,?,?,?,?,?,1,0)",id,tenant,"fm_"+phone,name.trim(),encoder.encode(UUID.randomUUID().toString()),phone);
  db.update("INSERT INTO app_flymind_account(user_id,password,status,created_at,updated_at) VALUES(?,?,1,?,?)",id,encoder.encode(password),System.currentTimeMillis(),System.currentTimeMillis());return ok(Map.of("id",id,"name",name.trim(),"phone",phone,"status",1,"userCode",FlymindUserDirectory.ensure(db,id,System.currentTimeMillis())));
 }
 @PatchMapping("/{id}") @PreAuthorize("hasAuthority('system:user:edit')") public ResponseEntity<Object> status(@PathVariable String id,@RequestBody Map<String,Object>b){id=accountId(id);if(!b.keySet().equals(Set.of("status"))||!(b.get("status")instanceof Number n)||(n.doubleValue()!=0&&n.doubleValue()!=1))throw bad();if(db.update("UPDATE app_flymind_account SET status=? WHERE user_id IN (SELECT user_id FROM sys_user WHERE user_id=? AND tenant_id=? AND is_deleted=0)",n.intValue(),id,tenant)!=1)throw new FlymindException(404,"ACCOUNT_NOT_FOUND","账号不存在");if(n.intValue()==0)revokeSessions(id);return ok(Map.of("success",true));}
 private String accountId(String value){try{long id=Long.parseLong(value);if(id<=0||!Long.toString(id).equals(value))throw bad();return value;}catch(NumberFormatException e){throw bad();}}
 private void revokeSessions(String id){FlymindAppAccounts.revoke(db,id,System.currentTimeMillis());}
 @PostMapping("/{id}/password") @PreAuthorize("hasAuthority('system:user:edit')") public ResponseEntity<Object> resetPassword(@PathVariable String id,@RequestBody Map<String,Object>b){id=accountId(id);
  if(!b.keySet().equals(Set.of("password"))||!(b.get("password")instanceof String password)||password.codePointCount(0,password.length())<6||password.isBlank()||password.getBytes(StandardCharsets.UTF_8).length>72)throw bad();
  if(db.update("UPDATE app_flymind_account SET password=? WHERE user_id IN (SELECT user_id FROM sys_user WHERE user_id=? AND tenant_id=? AND is_deleted=0)",encoder.encode(password),id,tenant)!=1)throw new FlymindException(404,"ACCOUNT_NOT_FOUND","账号不存在");
  revokeSessions(id);return ok(Map.of("success",true));
 }
}
