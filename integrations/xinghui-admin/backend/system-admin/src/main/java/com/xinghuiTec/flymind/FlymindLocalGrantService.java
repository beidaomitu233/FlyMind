package com.xinghuiTec.flymind;

import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import java.security.SecureRandom;
import java.util.*;

/** Local grants reuse authoritative account/session/team facts; no local password or offline grace. */
@Service
@Transactional(noRollbackFor=FlymindException.class)
public class FlymindLocalGrantService {
 private final JdbcTemplate db;private final FlymindIdentityService identity;private final String tenant;
 public FlymindLocalGrantService(JdbcTemplate db,FlymindIdentityService identity,@Value("${FLYMIND_APP_TENANT_ID}")String tenant){this.db=db;this.identity=identity;this.tenant=tenant;}
 private FlymindException unauthorized(){return new FlymindException(401,"LOCAL_LOGIN_REQUIRED","本地授权失效，请重新登录");}
 private void binding(String device,String root){if(device==null||!device.matches("[A-Za-z0-9_-]{43}")||root==null||!root.matches("[A-Za-z0-9_-]{1,100}"))throw new FlymindException(400,"INVALID_LOCAL_BINDING","设备或工作区身份无效");}
 private String raw(String bearer){if(bearer==null||!bearer.matches("Bearer fm_local_[A-Za-z0-9_-]{43}"))throw unauthorized();return bearer.substring(7);}
 public Map<String,Object> create(String bearer,String device,String root,String teamId){
  binding(device,root);var actor=identity.authenticate(bearer);
  // Serialize rotation against account disable/password reset and simultaneous grants.
  db.queryForList("SELECT user_id FROM sys_user WHERE user_id=? FOR UPDATE",actor.user().id());actor=identity.authenticate(bearer);
  // Membership removal and team disable use this same team row lock.
  db.queryForList("SELECT id FROM app_flymind_team WHERE id=? FOR UPDATE",teamId);identity.introspect(bearer,teamId);
  String key=FlymindIdentityService.hash(actor.user().id()+"\n"+device+"\n"+root),token="fm_local_"+random(),digest=FlymindIdentityService.hash(token);long now=System.currentTimeMillis();
  var rows=db.queryForList("SELECT id,team_id FROM app_flymind_local_grant WHERE binding_key=? FOR UPDATE",key);
  if(!rows.isEmpty()&&!teamId.equals(rows.get(0).get("team_id")))throw new FlymindException(409,"LOCAL_BINDING_MISMATCH","设备工作区已绑定其他团队");
  if(rows.isEmpty())db.update("INSERT INTO app_flymind_local_grant(id,binding_key,token_hash,session_id,user_id,team_id,device_hash,data_root_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)",UUID.randomUUID().toString(),key,digest,actor.session().id(),actor.user().id(),teamId,FlymindIdentityService.hash(device),root,now,actor.session().expiresAt());
  else db.update("UPDATE app_flymind_local_grant SET token_hash=?,session_id=?,created_at=?,expires_at=?,revoked_at=NULL WHERE binding_key=?",digest,actor.session().id(),now,actor.session().expiresAt(),key);
  return Map.of("grantToken",token,"expiresAt",actor.session().expiresAt());
 }
 private static String random(){byte[] b=new byte[32];new SecureRandom().nextBytes(b);return Base64.getUrlEncoder().withoutPadding().encodeToString(b);}
 private Map<String,Object> bound(String bearer,String device,String root){binding(device,root);var rows=db.queryForList("SELECT * FROM app_flymind_local_grant WHERE token_hash=? FOR UPDATE",FlymindIdentityService.hash(raw(bearer)));if(rows.size()!=1)throw unauthorized();var grant=rows.get(0);if(!FlymindIdentityService.hash(device).equals(grant.get("device_hash"))||!root.equals(grant.get("data_root_id")))throw new FlymindException(403,"LOCAL_BINDING_MISMATCH","设备或工作区绑定不匹配");return grant;}
 public Map<String,Object> introspect(String bearer,String device,String root){
  var grant=bound(bearer,device,root);long now=System.currentTimeMillis();
  var valid=db.queryForList("SELECT u.user_id,COALESCE(NULLIF(u.nickname,''),u.username) AS display_name,s.expires_at,t.name,m.role FROM app_flymind_session s JOIN sys_user u ON u.user_id=s.user_id JOIN app_flymind_account a ON a.user_id=u.user_id JOIN app_flymind_team t ON t.id=? JOIN app_flymind_member m ON m.team_id=t.id AND m.user_id=u.user_id WHERE s.id=? AND s.user_id=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.tenant_id=? AND a.status=1 AND u.is_deleted=0 AND t.status=1",grant.get("team_id"),grant.get("session_id"),grant.get("user_id"),now,tenant);
  if(grant.get("revoked_at")!=null||((Number)grant.get("expires_at")).longValue()<=now||valid.size()!=1){db.update("UPDATE app_flymind_local_grant SET revoked_at=COALESCE(revoked_at,?) WHERE id=?",now,grant.get("id"));throw unauthorized();}
  var row=valid.get(0);long expires=Math.min(((Number)row.get("expires_at")).longValue(),((Number)grant.get("expires_at")).longValue());
  return Map.of("user",Map.of("id",row.get("user_id").toString(),"name",row.get("display_name")),"session",Map.of("id",grant.get("id"),"expiresAt",expires),"team",Map.of("id",grant.get("team_id"),"name",row.get("name"),"role",row.get("role")),"binding",Map.of("deviceId",device,"dataRootId",root));
 }
 public void revoke(String bearer,String device,String root){var grant=bound(bearer,device,root);long now=System.currentTimeMillis();db.update("UPDATE app_flymind_local_grant SET revoked_at=COALESCE(revoked_at,?) WHERE id=?",now,grant.get("id"));db.update("UPDATE app_flymind_session SET revoked_at=COALESCE(revoked_at,?) WHERE id=?",now,grant.get("session_id"));}
}
