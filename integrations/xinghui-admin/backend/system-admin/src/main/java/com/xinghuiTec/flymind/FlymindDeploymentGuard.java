package com.xinghuiTec.flymind;

import com.xinghuiTec.constants.JwtConstants;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import java.net.URI;
import java.nio.charset.StandardCharsets;

/** Fail before serving traffic when required deployment identity settings are absent. */
@Component
public class FlymindDeploymentGuard {
 public FlymindDeploymentGuard(@Value("${FLYMIND_GATEWAY_KEY:}") String gateway,
                               @Value("${FLYMIND_CLOUD_PUBLIC_ORIGIN:}") String origin){
  if(JwtConstants.TOKEN_SIGN_KEY.length<32)throw new IllegalStateException("JWT_SECRET is required");
  if(gateway.getBytes(StandardCharsets.UTF_8).length<32)throw new IllegalStateException("FLYMIND_GATEWAY_KEY requires at least 32 UTF-8 bytes");
  try {
   URI uri=URI.create(origin);String host=uri.getHost();boolean loopback=host!=null&&(host.equals("localhost")||host.equals("127.0.0.1")||host.equals("[::1]"));
   if(host==null||uri.getUserInfo()!=null||uri.getRawQuery()!=null||uri.getRawFragment()!=null||!uri.getRawPath().isEmpty()||!(uri.getScheme().equals("https")||uri.getScheme().equals("http")&&loopback))throw new IllegalArgumentException();
  }catch(RuntimeException error){throw new IllegalStateException("FLYMIND_CLOUD_PUBLIC_ORIGIN must be an exact HTTPS origin (loopback HTTP for isolated testing only)");}
 }
}
