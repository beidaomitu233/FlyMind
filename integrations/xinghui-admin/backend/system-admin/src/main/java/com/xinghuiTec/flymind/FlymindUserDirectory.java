package com.xinghuiTec.flymind;

import java.security.SecureRandom;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;

/** Public identifiers never replace internal user ids or authorization checks. */
final class FlymindUserDirectory {
 private static final char[] ALPHABET="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".toCharArray();
 private static final SecureRandom RANDOM=new SecureRandom();
 private FlymindUserDirectory(){}
 static String ensure(JdbcTemplate db,String userId,long now){
  List<String> found=db.query("SELECT user_code FROM app_flymind_user_code WHERE user_id=?",(r,n)->r.getString(1),userId);
  if(!found.isEmpty())return found.get(0);
  // Only new allocation locks the identity; ordinary authenticated reads do not.
  db.queryForObject("SELECT user_id FROM sys_user WHERE user_id=? FOR UPDATE",String.class,userId);
  found=db.query("SELECT user_code FROM app_flymind_user_code WHERE user_id=?",(r,n)->r.getString(1),userId);
  if(!found.isEmpty())return found.get(0);
  for(int attempt=0;attempt<32;attempt++){
   StringBuilder value=new StringBuilder();for(int i=0;i<6;i++)value.append(ALPHABET[RANDOM.nextInt(ALPHABET.length)]);
   String code=value.toString();if(!code.matches("(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{6}"))continue;
   try{db.update("INSERT INTO app_flymind_user_code(user_id,user_code,created_at) VALUES(?,?,?)",userId,code,now);return code;}catch(DuplicateKeyException collision){/* bounded random collision retry */}
  }
  throw new FlymindException(503,"USER_CODE_UNAVAILABLE","暂时无法分配用户编号，请重试");
 }
 static void access(JdbcTemplate db,String userId,long now,boolean login){
  String day=Instant.ofEpochMilli(now).atZone(ZoneOffset.UTC).toLocalDate().toString();
  int changed=db.update("UPDATE app_flymind_access_day SET last_at=?,login_count=login_count+? WHERE user_id=? AND day_utc=?",now,login?1:0,userId,day);
  if(changed==0)try{db.update("INSERT INTO app_flymind_access_day(user_id,day_utc,login_count,first_at,last_at) VALUES(?,?,?,?,?)",userId,day,login?1:0,now,now);}catch(DuplicateKeyException concurrent){db.update("UPDATE app_flymind_access_day SET last_at=?,login_count=login_count+? WHERE user_id=? AND day_utc=?",now,login?1:0,userId,day);}
 }
}
