package com.xinghuiTec.flymind.oauth;

import java.util.List;

public final class OAuthInputs {
    private OAuthInputs() {}
    public record Authorization(String clientId, String redirectUri, String codeChallenge,
                                List<String> scopes, String state, String resource) {}
    public record Request(String requestId) {}
    public record Approval(String requestId, String teamId, Boolean approved) {}
    public record Code(String clientId, String code, String codeVerifier, String redirectUri, String resource) {}
    public record Refresh(String clientId, String refreshToken, List<String> scopes, String resource) {}
    public record Introspection(String resource, String teamId) {}
    public record Revoke(String clientId, String token, String tokenTypeHint) {}
    public record RequestResult(String requestId, long expiresAt) {}
    public record Redirect(String redirectUri) {}
    public record Tokens(String access_token, String token_type, long expires_in, String refresh_token, String scope) {}
}
