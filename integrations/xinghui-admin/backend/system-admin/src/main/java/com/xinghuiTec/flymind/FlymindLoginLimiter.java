package com.xinghuiTec.flymind;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;
import java.util.List;

@Component
public class FlymindLoginLimiter {
 private final StringRedisTemplate redis;
 private static final DefaultRedisScript<Long> COUNT = new DefaultRedisScript<>("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",Long.class);
 public FlymindLoginLimiter(StringRedisTemplate redis){this.redis=redis;}
 public void check(String ip,String phone){
  count("ip:"+FlymindIdentityService.hash(ip),30);
  count("account:"+FlymindIdentityService.hash(phone),10);
 }
 /** Independent registration counters; remote address is not taken from untrusted XFF.
  * A shared gateway shares the IP ceiling; phone counters remain independent. */
 private static final DefaultRedisScript<Long> REGISTRATION_COUNT=new DefaultRedisScript<>("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],900) end; return n",Long.class);
 public void checkRegistration(String ip,String phone){
  registrationCount("ip:"+FlymindIdentityService.hash(ip),120);
  registrationCount("account:"+FlymindIdentityService.hash(phone),5);
 }
 private void registrationCount(String key,int limit){
  Long n;
  try{n=redis.execute(REGISTRATION_COUNT,List.of("flymind:registration-limit:"+key));}
  catch(org.springframework.dao.DataAccessException unavailable){throw new FlymindException(503,"IDENTITY_UNAVAILABLE","注册服务暂时不可用，请稍后重试");}
  if(n==null)throw new FlymindException(503,"IDENTITY_UNAVAILABLE","注册服务暂时不可用，请稍后重试");
  if(n>limit)throw new FlymindException(429,"RATE_LIMITED","注册过于频繁，请稍后重试");
 }
 private void count(String key,int limit){
  Long n=redis.execute(COUNT,List.of("flymind:login-limit:"+key));
  if(n==null)throw new FlymindException(503,"IDENTITY_UNAVAILABLE","身份服务暂时不可用");
  if(n>limit)throw new FlymindException(429,"RATE_LIMITED","登录过于频繁，请稍后重试");
 }
}
