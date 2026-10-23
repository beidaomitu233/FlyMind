package com.xinghuiTec.flymind;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.EventListener;
import org.springframework.core.annotation.Order;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;

/** Deployment probe, separate from user/admin authentication and never a login bypass. */
@RestController
public class FlymindReadiness {
 public static final String PATH="/internal/flymind/readyz";
 private final JdbcTemplate db;
 private final RedisConnectionFactory redis;
 private final byte[] key;
 private final String jarSha256;
 private volatile boolean started;
 public FlymindReadiness(JdbcTemplate db,RedisConnectionFactory redis,
   @Value("${FLYMIND_GATEWAY_KEY:}") String key) {
  this.db=db;this.redis=redis;this.key=key.getBytes(StandardCharsets.UTF_8);
  try {
   var source=new org.springframework.boot.system.ApplicationHome(FlymindReadiness.class).getSource();
   Path location=source==null?null:source.toPath();
   if(location!=null&&Files.isRegularFile(location)) {
    MessageDigest hash=MessageDigest.getInstance("SHA-256");
    try(var input=new DigestInputStream(Files.newInputStream(location),hash)){input.transferTo(java.io.OutputStream.nullOutputStream());}
    jarSha256=HexFormat.of().formatHex(hash.digest());
   } else jarSha256=""; // Test classes are not an installable JAR; publisher must reject an empty hash.
  } catch(Exception error){throw new IllegalStateException("Cannot identify the running control-plane JAR");}
 }
 @EventListener(ApplicationReadyEvent.class) public void onReady(){started=true;}
 @GetMapping(PATH) public ResponseEntity<Map<String,Object>> ready(HttpServletRequest request) {
  String remote=request.getRemoteAddr(),supplied=request.getHeader("X-FlyMind-Gateway-Key");
  if(!("127.0.0.1".equals(remote)||"0:0:0:0:0:0:0:1".equals(remote)||"::1".equals(remote))||key.length<32||supplied==null||supplied.length()>512||!MessageDigest.isEqual(key,supplied.getBytes(StandardCharsets.UTF_8)))
   return ResponseEntity.status(401).header("Cache-Control","no-store").body(Map.of("ready",false));
  try {
   if(!started)throw new IllegalStateException();
   db.queryForList("SELECT user_id,password,status FROM app_flymind_account WHERE 1=0");
   db.queryForList("SELECT ur.user_id FROM sys_user_role ur LEFT JOIN sys_role_menu rm ON ur.role_id=rm.role_id WHERE 1=0");
   try(var connection=redis.getConnection()) {if(!"PONG".equals(connection.ping()))throw new IllegalStateException();}
   return ResponseEntity.ok().header("Cache-Control","no-store").body(Map.of("ready",true,"jarSha256",jarSha256));
  }catch(Exception error){return ResponseEntity.status(503).header("Cache-Control","no-store").body(Map.of("ready",false));}
 }
 @Configuration static class Security {
  @Bean @Order(-5) SecurityFilterChain controlPlaneProbe(HttpSecurity http)throws Exception {
   return http.securityMatcher(PATH).csrf(c->c.disable()).sessionManagement(s->s.sessionCreationPolicy(SessionCreationPolicy.STATELESS)).authorizeHttpRequests(a->a.anyRequest().permitAll()).build();
  }
 }
}
