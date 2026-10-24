package com.xinghuiTec.flymind;

import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/admin/flymind/overview")
public class FlymindOverviewController {
 private final JdbcTemplate db;private final String tenant;
 public FlymindOverviewController(JdbcTemplate db,@Value("${FLYMIND_APP_TENANT_ID}")String tenant){this.db=db;this.tenant=tenant;}
 private long count(String sql,Object... args){Long n=db.queryForObject(sql,Long.class,args);return n==null?0:n;}
 @GetMapping @PreAuthorize("hasAuthority('flymind:dashboard:view')")
 public ResponseEntity<Object> overview(@RequestParam(defaultValue="30")int days){
  if(days!=7&&days!=30)throw new FlymindException(400,"INVALID_INPUT","days仅支持7或30");
  long now=System.currentTimeMillis();String users=" FROM app_flymind_account a JOIN sys_user u ON u.user_id=a.user_id WHERE u.tenant_id=? AND u.is_deleted=0";
  String members=" FROM app_flymind_member m JOIN app_flymind_account a ON a.user_id=m.user_id JOIN sys_user u ON u.user_id=m.user_id WHERE u.tenant_id=? AND u.is_deleted=0";
  String invites=" FROM app_flymind_invite i JOIN sys_user u ON u.user_id=i.user_id WHERE u.tenant_id=? AND u.is_deleted=0";
  List<Map<String,Object>> trend=new ArrayList<>();LocalDate today=Instant.ofEpochMilli(now).atZone(ZoneOffset.UTC).toLocalDate();
  for(int offset=days-1;offset>=0;offset--){LocalDate day=today.minusDays(offset);long start=day.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),end=day.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli();
   String access=" FROM app_flymind_access_day d JOIN sys_user u ON u.user_id=d.user_id WHERE u.tenant_id=? AND u.is_deleted=0 AND d.day_utc=?";
   trend.add(Map.of("date",day.toString(),"newUsers",count("SELECT COUNT(*)"+users+" AND a.created_at>=? AND a.created_at<?",tenant,start,end),"loginUsers",count("SELECT COUNT(*)"+access+" AND d.login_count>0",tenant,day.toString()),"loginCount",count("SELECT COALESCE(SUM(d.login_count),0)"+access,tenant,day.toString()),"activeUsers",count("SELECT COUNT(*)"+access,tenant,day.toString())));
  }
  Long since=db.queryForObject("SELECT MIN(d.first_at) FROM app_flymind_access_day d JOIN sys_user u ON u.user_id=d.user_id WHERE u.tenant_id=?",Long.class,tenant);
  Map<String,Object> value=new LinkedHashMap<>();value.put("generatedAt",now);value.put("timezone","UTC");value.put("days",days);value.put("activitySince",since);
  value.put("users",Map.of("total",count("SELECT COUNT(*)"+users,tenant),"enabled",count("SELECT COUNT(*)"+users+" AND a.status=1",tenant),"disabled",count("SELECT COUNT(*)"+users+" AND a.status=0",tenant)));
  String teams=" FROM app_flymind_team t WHERE EXISTS(SELECT 1 FROM app_flymind_member m JOIN sys_user u ON u.user_id=m.user_id WHERE m.team_id=t.id AND u.tenant_id=?)";
  value.put("teams",Map.of("total",count("SELECT COUNT(*)"+teams,tenant),"enabled",count("SELECT COUNT(*)"+teams+" AND t.status=1",tenant),"disabled",count("SELECT COUNT(*)"+teams+" AND t.status=0",tenant),"members",count("SELECT COUNT(*)"+members,tenant)));
  value.put("invites",Map.of("pending",count("SELECT COUNT(*)"+invites+" AND i.accepted_at IS NULL AND i.declined_at IS NULL AND i.expires_at>?",tenant,now),"accepted",count("SELECT COUNT(*)"+invites+" AND i.accepted_at IS NOT NULL",tenant),"declined",count("SELECT COUNT(*)"+invites+" AND i.declined_at IS NOT NULL",tenant),"expired",count("SELECT COUNT(*)"+invites+" AND i.accepted_at IS NULL AND i.declined_at IS NULL AND i.expires_at<=?",tenant,now)));
  String grant=" g JOIN sys_user u ON u.user_id=g.user_id JOIN app_flymind_account a ON a.user_id=u.user_id JOIN app_flymind_team t ON t.id=g.team_id JOIN app_flymind_member m ON m.user_id=g.user_id AND m.team_id=g.team_id WHERE u.tenant_id=? AND u.is_deleted=0 AND a.status=1 AND t.status=1 AND g.revoked_at IS NULL AND g.expires_at>?";
  value.put("authorizations",Map.of("activeMcpGrants",count("SELECT COUNT(*) FROM app_flymind_oauth_grant"+grant,tenant,now),"activeDevices",count("SELECT COUNT(*) FROM app_flymind_local_grant"+grant+" AND EXISTS(SELECT 1 FROM app_flymind_session s WHERE s.id=g.session_id AND s.user_id=g.user_id AND s.revoked_at IS NULL AND s.expires_at>?)",tenant,now,now)));
  value.put("trend",trend);value.put("definitions",Map.of("users","受控tenant未删除的前台账号；不含纯后台管理员","teams","有本tenant成员的空间，包含个人空间；members为成员关系数而非去重人数","newUsers","前台credential创建时间，兼容迁移账号记迁移时间，不推测历史注册日期","loginUsers","UTC日成功前台密码登录的去重用户；loginCount为成功次数","activeUsers","UTC日通过应用session鉴权的去重用户；不包含MCP/device专用令牌访问","activitySince","最早已采集成功事件时间；null表示尚无采集，不补造历史活跃","authorizations","账号/空间启用且成员仍存在、未撤销、未到期的授权数；不代表在线人数"));
  return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("code",200,"message","成功","data",value));
 }
}
