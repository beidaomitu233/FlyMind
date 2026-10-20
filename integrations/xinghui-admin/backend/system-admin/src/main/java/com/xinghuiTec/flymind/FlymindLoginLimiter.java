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
 private void count(String key,int limit){
  Long n=redis.execute(COUNT,List.of("flymind:login-limit:"+key));
  if(n==null)throw new FlymindException(503,"IDENTITY_UNAVAILABLE","身份服务暂时不可用");
  if(n>limit)throw new FlymindException(429,"RATE_LIMITED","登录过于频繁，请稍后重试");
 }
}
