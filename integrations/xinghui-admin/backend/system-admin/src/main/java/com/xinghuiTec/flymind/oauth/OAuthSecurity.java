package com.xinghuiTec.flymind.oauth;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.filter.OncePerRequestFilter;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;

@Configuration
public class OAuthSecurity {
    @Bean @Order(0)
    SecurityFilterChain oauthChain(HttpSecurity http,ObjectMapper json,@Value("${FLYMIND_GATEWAY_KEY:}")String configured) throws Exception {
        byte[] key=configured.getBytes(StandardCharsets.UTF_8);
        OncePerRequestFilter gateway=new OncePerRequestFilter() {
            @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws ServletException,IOException {
                response.setHeader("Cache-Control","no-store");
                String supplied=request.getHeader("X-FlyMind-Gateway-Key");
                int status=key.length<32?503:supplied==null||supplied.getBytes(StandardCharsets.UTF_8).length>512||!MessageDigest.isEqual(key,supplied.getBytes(StandardCharsets.UTF_8))?401:0;
                if(status!=0){response.setStatus(status);response.setContentType("application/json;charset=UTF-8");String error=status==503?"temporarily_unavailable":"invalid_client";json.writeValue(response.getWriter(),Map.of("code",status,"message",error,"data",Map.of("error",error)));return;}
                chain.doFilter(request,response);
            }
        };
        return http.securityMatcher("/app/flymind/oauth/**").csrf(c->c.disable()).sessionManagement(s->s.sessionCreationPolicy(SessionCreationPolicy.STATELESS)).authorizeHttpRequests(a->a.anyRequest().permitAll()).addFilterBefore(gateway,UsernamePasswordAuthenticationFilter.class).build();
    }
}
