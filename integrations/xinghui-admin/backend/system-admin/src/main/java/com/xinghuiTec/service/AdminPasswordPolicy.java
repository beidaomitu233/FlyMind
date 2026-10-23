package com.xinghuiTec.service;

import com.xinghuiTec.exception.ServiceException;
import java.nio.charset.StandardCharsets;

/** Backend password policy; application credentials have their own policy. */
public final class AdminPasswordPolicy {
 private AdminPasswordPolicy() {}
 public static String validated(String password) {
  if(password==null||password.isBlank()||password.codePointCount(0,password.length())<12||password.getBytes(StandardCharsets.UTF_8).length>72)
   throw new ServiceException("后台密码至少12字符且不超过72 UTF-8字节");
  return password;
 }
}
