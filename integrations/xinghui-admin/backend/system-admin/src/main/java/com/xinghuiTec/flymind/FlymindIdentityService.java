package com.xinghuiTec.flymind;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.*;
import java.util.function.LongSupplier;

@Service
@Transactional
public class FlymindIdentityService {
 public record User(String id,String name,String userCode){}
 public record Session(String id,long expiresAt){}
 public record Actor(User user,Session session){}
 public record Team(String id,String name,String role){}
 public record Member(String userId,String name,String role,String userCode){}
 public record Login(String sessionToken,long expiresAt,User user){}
 public record Invite(String id,String inviteToken,long expiresAt){}
 private final JdbcTemplate db;
 private final PasswordEncoder passwords;
 private final FlymindLoginLimiter limiter;
 private final String tenant;
 private final LongSupplier clock;
 private final String dummyPassword;
 @org.springframework.beans.factory.annotation.Autowired
 public FlymindIdentityService(JdbcTemplate db,PasswordEncoder passwords,FlymindLoginLimiter limiter,@Value("${FLYMIND_APP_TENANT_ID}") String tenant){this(db,passwords,limiter,tenant,System::currentTimeMillis);}
 public FlymindIdentityService(JdbcTemplate db,PasswordEncoder passwords,FlymindLoginLimiter limiter,String tenant,LongSupplier clock){
  if(tenant==null||tenant.isBlank()||tenant.length()>20)throw new IllegalArgumentException("FLYMIND_APP_TENANT_ID must be explicitly configured (1-20 chars)");
  this.db=db;this.passwords=passwords;this.limiter=limiter;this.tenant=tenant;this.clock=clock;this.dummyPassword=passwords.encode(UUID.randomUUID().toString());
 }
 public static String hash(String value){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));}catch(Exception e){throw new IllegalStateException(e);}}
 private static String id(){return UUID.randomUUID().toString();}
 private static String token(){byte[] b=new byte[32];new SecureRandom().nextBytes(b);return Base64.getUrlEncoder().withoutPadding().encodeToString(b);}
 private FlymindException bad(){return new FlymindException(400,"INVALID_INPUT","请求参数不合法");}
 private FlymindException denied(){return new FlymindException(403,"ACCESS_DENIED","无权访问此资源");}
 private FlymindException unauthorized(){return new FlymindException(401,"UNAUTHENTICATED","登录已失效或账号不可用");}
 private String name(String s){if(s==null||s.trim().isEmpty()||s.trim().length()>80)throw bad();return s.trim();}
 private String role(String role){if(!Set.of("admin","editor","viewer").contains(role==null?"":role))throw bad();return role;}
 private String raw(String bearer){if(bearer==null||!bearer.matches("Bearer [A-Za-z0-9_-]{43}"))throw unauthorized();return bearer.substring(7);}
 private record Account(String id,String name,String password){}
 private List<Account> account(String phone,boolean lock){return db.query("SELECT u.user_id,COALESCE(NULLIF(u.nickname,''),u.username) AS display_name,a.password FROM sys_user u JOIN app_flymind_account a ON a.user_id=u.user_id WHERE u.mobile=? AND u.tenant_id=? AND a.status=1 AND u.is_deleted=0"+(lock?" FOR UPDATE":""),(r,n)->new Account(r.getString("user_id"),r.getString("display_name"),r.getString("password")),phone,tenant);}
 public Login login(String phone,String password,String ip){
  if(phone==null||password==null||phone.length()>32||password.getBytes(StandardCharsets.UTF_8).length>72)throw new FlymindException(401,"INVALID_CREDENTIALS","手机号或密码错误");
  limiter.check(ip==null?"unknown":ip,phone);
  List<Account> rows=account(phone,true);Account a=rows.size()==1?rows.get(0):null;
  if(!passwords.matches(password,a==null?dummyPassword:a.password()))throw new FlymindException(401,"INVALID_CREDENTIALS","手机号或密码错误");
  if(a==null)throw new FlymindException(401,"INVALID_CREDENTIALS","手机号或密码错误");
  if(db.queryForObject("SELECT COUNT(*) FROM app_flymind_team WHERE personal_user_id=?",Integer.class,a.id())==0){String teamId=id();db.update("INSERT INTO app_flymind_team(id,name,type,personal_user_id,status,created_at) VALUES(?,?,'personal',?,1,?)",teamId,"个人空间",a.id(),clock.getAsLong());db.update("INSERT INTO app_flymind_member(team_id,user_id,role,created_at) VALUES(?,?,'owner',?)",teamId,a.id(),clock.getAsLong());}
  String plain=token(),sid=id();long now=clock.getAsLong(),expires=now+7L*24*60*60*1000;
  db.update("INSERT INTO app_flymind_session(id,user_id,token_hash,created_at,expires_at) VALUES(?,?,?,?,?)",sid,a.id(),hash(plain),now,expires);
  FlymindUserDirectory.access(db,a.id(),now,true);return new Login(plain,expires,new User(a.id(),a.name(),FlymindUserDirectory.ensure(db,a.id(),now)));
 }
 @Transactional(noRollbackFor=FlymindException.class)
 public Actor authenticate(String bearer){
  String digest=hash(raw(bearer));
  List<Actor> rows=db.query("SELECT s.id,s.expires_at,u.user_id,COALESCE(NULLIF(u.nickname,''),u.username) AS display_name FROM app_flymind_session s JOIN sys_user u ON u.user_id=s.user_id JOIN app_flymind_account a ON a.user_id=u.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.tenant_id=? AND a.status=1 AND u.is_deleted=0",(r,n)->new Actor(new User(r.getString("user_id"),r.getString("display_name"),FlymindUserDirectory.ensure(db,r.getString("user_id"),clock.getAsLong())),new Session(r.getString("id"),r.getLong("expires_at"))),digest,clock.getAsLong(),tenant);
  if(rows.size()!=1)throw unauthorized();FlymindUserDirectory.access(db,rows.get(0).user().id(),clock.getAsLong(),false);return rows.get(0);
 }
 public List<Team> teams(String bearer){Actor a=authenticate(bearer);return listTeams(a);}
 private List<Team> listTeams(Actor a){return db.query("SELECT t.id,t.name,m.role FROM app_flymind_team t JOIN app_flymind_member m ON m.team_id=t.id WHERE m.user_id=? AND t.status=1 ORDER BY t.created_at,t.id",(r,n)->new Team(r.getString(1),r.getString(2),r.getString(3)),a.user().id());}
 public Map<String,Object> me(String bearer){Actor a=authenticate(bearer);return Map.of("user",a.user(),"expiresAt",a.session().expiresAt(),"teams",listTeams(a));}
 public void logout(String bearer){Actor a=authenticate(bearer);db.update("UPDATE app_flymind_session SET revoked_at=? WHERE id=?",clock.getAsLong(),a.session().id());}
 public void changePassword(String bearer,String newPassword){
  Actor actor=authenticate(bearer);FlymindAppAccounts.validatePassword(newPassword);
  limiter.check("password-change",actor.user().id());
  List<String> hashes=db.query("SELECT a.password FROM app_flymind_account a JOIN sys_user u ON u.user_id=a.user_id WHERE a.user_id=? AND a.status=1 AND u.tenant_id=? AND u.is_deleted=0 FOR UPDATE",(r,n)->r.getString(1),actor.user().id(),tenant);
  if(hashes.size()!=1)throw unauthorized();
  long now=clock.getAsLong();db.update("UPDATE app_flymind_account SET password=?,updated_at=? WHERE user_id=?",passwords.encode(newPassword),now,actor.user().id());
  FlymindAppAccounts.revoke(db,actor.user().id(),now);
 }
 private Team membership(Actor a,String teamId,boolean lock){
  if(teamId==null||teamId.length()>36)throw bad();
  if(lock){List<String> found=db.query("SELECT id FROM app_flymind_team WHERE id=? AND status=1 FOR UPDATE",(r,n)->r.getString(1),teamId);if(found.size()!=1)throw denied();}
  List<Team> rows=db.query("SELECT t.id,t.name,m.role FROM app_flymind_team t JOIN app_flymind_member m ON m.team_id=t.id WHERE t.id=? AND t.status=1 AND m.user_id=?",(r,n)->new Team(r.getString(1),r.getString(2),r.getString(3)),teamId,a.user().id());if(rows.size()!=1)throw denied();return rows.get(0);
 }
 @Transactional(noRollbackFor=FlymindException.class)
 public Map<String,Object> introspect(String bearer,String teamId){Actor a=authenticate(bearer);return Map.of("user",a.user(),"session",a.session(),"team",membership(a,teamId,false));}
 public Team createTeam(String bearer,String name){Actor a=authenticate(bearer);String teamId=id(),trim=name(name);db.update("INSERT INTO app_flymind_team(id,name,type,status,created_at) VALUES(?,?,'team',1,?)",teamId,trim,clock.getAsLong());db.update("INSERT INTO app_flymind_member(team_id,user_id,role,created_at) VALUES(?,?,'owner',?)",teamId,a.user().id(),clock.getAsLong());return new Team(teamId,trim,"owner");}
 private void manager(Team t){if(!Set.of("owner","admin").contains(t.role()))throw denied();}
 public Team renameTeam(String bearer,String teamId,String name){Actor a=authenticate(bearer);Team t=membership(a,teamId,true);manager(t);String trim=name(name);db.update("UPDATE app_flymind_team SET name=? WHERE id=?",trim,teamId);return new Team(teamId,trim,t.role());}
 public List<Member> members(String bearer,String teamId){Actor a=authenticate(bearer);membership(a,teamId,false);return db.query("SELECT u.user_id,COALESCE(NULLIF(u.nickname,''),u.username),m.role FROM app_flymind_member m JOIN sys_user u ON u.user_id=m.user_id WHERE m.team_id=? AND u.tenant_id=? AND u.is_deleted=0 ORDER BY m.created_at,u.user_id",(r,n)->new Member(r.getString(1),r.getString(2),r.getString(3),FlymindUserDirectory.ensure(db,r.getString(1),clock.getAsLong())),teamId,tenant);}
 public Invite invite(String bearer,String teamId,String phone,String requestedRole){Actor a=authenticate(bearer);Team t=membership(a,teamId,true);manager(t);String r=role(requestedRole);if("admin".equals(r)&&!"owner".equals(t.role()))throw denied();if("personal".equals(db.queryForObject("SELECT type FROM app_flymind_team WHERE id=?",String.class,teamId)))throw denied();List<Account> target=account(phone,false);if(target.size()!=1)throw new FlymindException(400,"INVITEE_UNAVAILABLE","请先由管理员开通受邀账号");String targetId=target.get(0).id();if(db.queryForObject("SELECT COUNT(*) FROM app_flymind_member WHERE team_id=? AND user_id=?",Integer.class,teamId,targetId)>0)throw new FlymindException(409,"ALREADY_MEMBER","对方已经是团队成员");List<Map<String,Object>> pending=db.queryForList("SELECT id,role,expires_at FROM app_flymind_invite WHERE team_id=? AND user_id=? AND accepted_at IS NULL AND declined_at IS NULL AND expires_at>?",teamId,targetId,clock.getAsLong());if(!pending.isEmpty()){var previous=pending.get(0);if(!r.equals(previous.get("role")))throw new FlymindException(409,"INVITE_ALREADY_PENDING","已有不同角色的待处理邀请");return new Invite(String.valueOf(previous.get("id")),"",((Number)previous.get("expires_at")).longValue());}String inviteId=id(),plain=token();long expires=clock.getAsLong()+48L*60*60*1000;db.update("INSERT INTO app_flymind_invite(id,team_id,user_id,role,token_hash,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)",inviteId,teamId,target.get(0).id(),r,hash(plain),a.user().id(),clock.getAsLong(),expires);return new Invite(inviteId,plain,expires);}
 public Invite inviteByCode(String bearer,String teamId,String userCode,String requestedRole){
  authenticate(bearer);if(userCode==null||!userCode.trim().toUpperCase(Locale.ROOT).matches("(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{6}"))throw bad();
  List<String> phones=db.query("SELECT u.mobile FROM app_flymind_user_code c JOIN sys_user u ON u.user_id=c.user_id JOIN app_flymind_account a ON a.user_id=u.user_id WHERE c.user_code=? AND u.tenant_id=? AND u.is_deleted=0 AND a.status=1",(r,n)->r.getString(1),userCode.trim().toUpperCase(Locale.ROOT),tenant);
  if(phones.size()!=1)throw new FlymindException(400,"INVITEE_UNAVAILABLE","受邀用户编号不存在或不可用");return invite(bearer,teamId,phones.get(0),requestedRole);
 }
 public List<Map<String,Object>> pendingInvites(String bearer){Actor a=authenticate(bearer);return db.query("SELECT i.id,i.team_id,t.name,i.role,i.created_at,i.expires_at,i.created_by,COALESCE(NULLIF(u.nickname,''),u.username),i.accepted_at,i.declined_at FROM app_flymind_invite i JOIN app_flymind_team t ON t.id=i.team_id JOIN sys_user u ON u.user_id=i.created_by WHERE i.user_id=? ORDER BY i.created_at DESC,i.id",(r,n)->Map.of("id",r.getString(1),"teamId",r.getString(2),"teamName",r.getString(3),"role",r.getString(4),"createdAt",r.getLong(5),"expiresAt",r.getLong(6),"inviterCode",FlymindUserDirectory.ensure(db,r.getString(7),clock.getAsLong()),"inviterName",r.getString(8),"status",r.getObject(9)!=null?"accepted":r.getObject(10)!=null?"declined":r.getLong(6)<=clock.getAsLong()?"expired":"pending"),a.user().id());}
 public Team acceptById(String bearer,String inviteId){Actor a=authenticate(bearer);return acceptRow(a,db.queryForList("SELECT id,team_id,user_id,role,created_by,expires_at,accepted_at,declined_at FROM app_flymind_invite WHERE id=? FOR UPDATE",inviteId));}
 public void decline(String bearer,String inviteId){Actor a=authenticate(bearer);if(db.update("UPDATE app_flymind_invite SET declined_at=? WHERE id=? AND user_id=? AND accepted_at IS NULL AND declined_at IS NULL AND expires_at>?",clock.getAsLong(),inviteId,a.user().id(),clock.getAsLong())!=1)throw new FlymindException(409,"INVITE_UNAVAILABLE","邀请无效或已处理");}
 public Team accept(String bearer,String plain){Actor a=authenticate(bearer);if(plain==null||!plain.matches("[A-Za-z0-9_-]{43}"))throw bad();List<Map<String,Object>> invites=db.queryForList("SELECT id,team_id,user_id,role,created_by,expires_at,accepted_at,declined_at FROM app_flymind_invite WHERE token_hash=? FOR UPDATE",hash(plain));return acceptRow(a,invites);}
 private Team acceptRow(Actor a,List<Map<String,Object>> invites){if(invites.size()!=1)throw denied();Map<String,Object> i=invites.get(0);if(!a.user().id().equals(String.valueOf(i.get("user_id")))||i.get("accepted_at")!=null||i.get("declined_at")!=null||((Number)i.get("expires_at")).longValue()<=clock.getAsLong())throw new FlymindException(409,"INVITE_UNAVAILABLE","邀请无效或已使用");String tid=String.valueOf(i.get("team_id"));List<String> names=db.query("SELECT name FROM app_flymind_team WHERE id=? AND status=1 AND type='team' FOR UPDATE",(r,n)->r.getString(1),tid);if(names.size()!=1)throw denied();if(db.queryForObject("SELECT COUNT(*) FROM app_flymind_member WHERE team_id=? AND user_id=?",Integer.class,tid,a.user().id())>0)throw new FlymindException(409,"ALREADY_MEMBER","已经是团队成员");String r=String.valueOf(i.get("role"));String inviter=memberRole(tid,String.valueOf(i.get("created_by")));if(!Set.of("owner","admin").contains(inviter)||("admin".equals(r)&&!"owner".equals(inviter)))throw denied();db.update("INSERT INTO app_flymind_member(team_id,user_id,role,created_at) VALUES(?,?,?,?)",tid,a.user().id(),r,clock.getAsLong());db.update("UPDATE app_flymind_invite SET accepted_at=? WHERE id=?",clock.getAsLong(),i.get("id"));return new Team(tid,names.get(0),r);}
 private String memberRole(String tid,String uid){List<String> rows=db.query("SELECT role FROM app_flymind_member WHERE team_id=? AND user_id=?",(r,n)->r.getString(1),tid,uid);if(rows.size()!=1)throw new FlymindException(404,"MEMBER_NOT_FOUND","成员不存在");return rows.get(0);}
 public void changeRole(String bearer,String tid,String uid,String requestedRole){Actor a=authenticate(bearer);Team t=membership(a,tid,true);manager(t);String old=memberRole(tid,uid),next=role(requestedRole);if("owner".equals(old)||(!"owner".equals(t.role())&&("admin".equals(old)||"admin".equals(next))))throw denied();db.update("UPDATE app_flymind_member SET role=? WHERE team_id=? AND user_id=?",next,tid,uid);}
 public void remove(String bearer,String tid,String uid){Actor a=authenticate(bearer);Team t=membership(a,tid,true);manager(t);String old=memberRole(tid,uid);if("owner".equals(old)||("admin".equals(old)&&!"owner".equals(t.role())))throw denied();db.update("DELETE FROM app_flymind_member WHERE team_id=? AND user_id=?",tid,uid);revokeLocalMembership(tid,uid);}
 public void leave(String bearer,String tid){Actor a=authenticate(bearer);Team t=membership(a,tid,true);if("owner".equals(t.role()))throw denied();db.update("DELETE FROM app_flymind_member WHERE team_id=? AND user_id=?",tid,a.user().id());revokeLocalMembership(tid,a.user().id());}
 private void revokeLocalMembership(String tid,String uid){db.update("UPDATE app_flymind_local_grant SET revoked_at=COALESCE(revoked_at,?) WHERE team_id=? AND user_id=?",clock.getAsLong(),tid,uid);}
 public void transfer(String bearer,String tid,String uid){Actor a=authenticate(bearer);Team t=membership(a,tid,true);if(!"owner".equals(t.role())||a.user().id().equals(uid))throw denied();memberRole(tid,uid);if("personal".equals(db.queryForObject("SELECT type FROM app_flymind_team WHERE id=?",String.class,tid)))throw denied();Integer enabled=db.queryForObject("SELECT COUNT(*) FROM sys_user u JOIN app_flymind_account a ON a.user_id=u.user_id WHERE u.user_id=? AND u.tenant_id=? AND a.status=1 AND u.is_deleted=0",Integer.class,uid,tenant);if(enabled==null||enabled!=1)throw denied();db.update("UPDATE app_flymind_member SET role='admin' WHERE team_id=? AND user_id=?",tid,a.user().id());db.update("UPDATE app_flymind_member SET role='owner' WHERE team_id=? AND user_id=?",tid,uid);}
}
