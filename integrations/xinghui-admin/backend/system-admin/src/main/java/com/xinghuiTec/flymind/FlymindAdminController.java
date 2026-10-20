package com.xinghuiTec.flymind;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.*;
import java.util.*;
@org.springframework.transaction.annotation.Transactional
@RestController
@RequestMapping("/admin/flymind/teams")
public class FlymindAdminController {
 private final JdbcTemplate db;
 public FlymindAdminController(JdbcTemplate db){this.db=db;}
 private ResponseEntity<Object> ok(Object data){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("code",200,"message","成功","data",data));}
 @GetMapping @PreAuthorize("hasAuthority('flymind:team:list')") public ResponseEntity<Object> list(){return ok(db.query("SELECT id,name,type,status,created_at FROM app_flymind_team ORDER BY created_at DESC,id LIMIT 200",(r,n)->Map.of("id",r.getString(1),"name",r.getString(2),"type",r.getString(3),"status",r.getInt(4),"createdAt",r.getLong(5))));}
 @GetMapping("/{id}/members") @PreAuthorize("hasAuthority('flymind:team:query')") public ResponseEntity<Object> members(@PathVariable String id){return ok(db.query("SELECT m.user_id,u.username,m.role FROM app_flymind_member m JOIN sys_user u ON u.user_id=m.user_id WHERE m.team_id=?",(r,n)->Map.of("userId",r.getString(1),"name",r.getString(2),"role",r.getString(3)),id));}
 @PatchMapping("/{id}") @PreAuthorize("hasAuthority('flymind:team:edit')") public ResponseEntity<Object> status(@PathVariable String id,@RequestBody Map<String,Object>b){if(!b.keySet().equals(Set.of("status"))||!(b.get("status")instanceof Number n)||(n.doubleValue()!=0&&n.doubleValue()!=1))throw new FlymindException(400,"INVALID_INPUT","状态不合法");if(db.update("UPDATE app_flymind_team SET status=? WHERE id=?",n.intValue(),id)!=1)throw new FlymindException(404,"TEAM_NOT_FOUND","团队不存在");if(n.intValue()==0)db.update("UPDATE app_flymind_local_grant SET revoked_at=COALESCE(revoked_at,?) WHERE team_id=?",System.currentTimeMillis(),id);return ok(Map.of("success",true));}
}
