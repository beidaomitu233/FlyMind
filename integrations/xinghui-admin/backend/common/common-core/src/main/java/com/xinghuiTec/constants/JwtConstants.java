package com.xinghuiTec.constants;
import java.nio.charset.StandardCharsets;
/** Deployment-supplied admin signing key. No development fallback. */
public interface JwtConstants {
 long TOKEN_EXPIRATION = 60 * 60 * 1000L * 24;
 byte[] TOKEN_SIGN_KEY = requiredSigningKey();
 String PAYLOAD_USER_ID = "userId";
 String PAYLOAD_TENANT_ID = "tenantId";
 private static byte[] requiredSigningKey() {
  String secret = System.getenv("JWT_SECRET");
  if (secret == null || secret.getBytes(StandardCharsets.UTF_8).length < 32)
   throw new IllegalStateException("JWT_SECRET must be explicitly configured with at least 32 UTF-8 bytes");
  return secret.getBytes(StandardCharsets.UTF_8);
 }
}
