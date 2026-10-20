package com.xinghuiTec.flymind;
import org.springframework.stereotype.Component;
import com.xinghuiTec.constants.JwtConstants;
/** Fail before serving either application/admin traffic if the deployment has no admin signing key. */
@Component
public class FlymindDeploymentGuard {
 public FlymindDeploymentGuard(){if(JwtConstants.TOKEN_SIGN_KEY.length<32)throw new IllegalStateException("JWT_SECRET is required");}
}
