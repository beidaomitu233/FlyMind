package com.xinghuiTec.flymind;

public final class FlymindException extends RuntimeException {
 public final int status;
 public final String code;
 public FlymindException(int status,String code,String message){super(message);this.status=status;this.code=code;}
}
