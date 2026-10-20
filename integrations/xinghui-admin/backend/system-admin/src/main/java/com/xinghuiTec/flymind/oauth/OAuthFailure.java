package com.xinghuiTec.flymind.oauth;

public final class OAuthFailure extends RuntimeException {
    public final int status;
    public final String error;
    public OAuthFailure(int status, String error) {
        super(error);
        this.status = status;
        this.error = error;
    }
}
