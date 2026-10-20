package com.xinghuiTec.flymind;

import org.springframework.context.annotation.*;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import com.xinghuiTec.filter.LoginFilter;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.Map;

@Configuration
public class FlymindSecurityConfig {
 @Bean public FilterRegistrationBean<LoginFilter> adminJwtServletRegistration(LoginFilter filter){FilterRegistrationBean<LoginFilter> registration=new FilterRegistrationBean<>(filter);registration.setEnabled(false);return registration;}
 @Bean @Order(1) public SecurityFilterChain flymindChain(HttpSecurity http,FlymindIdentityService service,ObjectMapper json)throws Exception {
  OncePerRequestFilter opaque=new OncePerRequestFilter(){
   @Override protected void doFilterInternal(HttpServletRequest req,HttpServletResponse res,FilterChain chain)throws ServletException,IOException {
    res.setHeader("Cache-Control","no-store");
    try {if(!("POST".equals(req.getMethod())&&(req.getContextPath()+"/app/flymind/auth/login").equals(req.getRequestURI())))service.authenticate(req.getHeader("Authorization"));}
    catch(FlymindException error){res.setStatus(error.status);res.setContentType("application/json;charset=UTF-8");json.writeValue(res.getWriter(),Map.of("code",error.status,"errorCode",error.code,"message",error.getMessage()));return;}
    catch(org.springframework.dao.DataAccessException error){res.setStatus(503);res.setContentType("application/json;charset=UTF-8");json.writeValue(res.getWriter(),Map.of("code",503,"errorCode","IDENTITY_UNAVAILABLE","message","身份服务暂时不可用"));return;}
    chain.doFilter(req,res);
   }
  };
  return http.securityMatcher("/app/flymind/**").csrf(c->c.disable()).sessionManagement(s->s.sessionCreationPolicy(SessionCreationPolicy.STATELESS)).authorizeHttpRequests(a->a.anyRequest().permitAll()).addFilterBefore(opaque,UsernamePasswordAuthenticationFilter.class).build();
 }
}
