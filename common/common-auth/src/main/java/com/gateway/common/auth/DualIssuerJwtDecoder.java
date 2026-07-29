package com.gateway.common.auth;

import com.nimbusds.jwt.SignedJWT;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

/**
 * A {@link JwtDecoder} that routes a token to one of two delegates based on its
 * {@code iss} (issuer) claim.
 * <p>
 * Tokens whose issuer matches the configured Keycloak issuer are validated with a
 * JWKS/issuer-location decoder (RS256, BDP SSO).  All other tokens fall through to
 * the {@code nativeDecoder} (the module's existing HMAC / issuer-location decoder for
 * identity-service tokens).  This lets the shared backends accept BOTH the native
 * identity-service tokens and BDP Keycloak SSO tokens simultaneously.
 * <p>
 * If no Keycloak issuer is configured (blank), this decoder behaves exactly like the
 * {@code nativeDecoder} — no behavior change.  The Keycloak delegate is built lazily
 * on first use so that Keycloak availability is not required at application start-up.
 */
public class DualIssuerJwtDecoder implements JwtDecoder {

    private static final Logger log = LoggerFactory.getLogger(DualIssuerJwtDecoder.class);

    private final JwtDecoder nativeDecoder;
    private final String keycloakIssuer;
    private volatile JwtDecoder keycloakDecoder;

    public DualIssuerJwtDecoder(JwtDecoder nativeDecoder, String keycloakIssuer) {
        if (nativeDecoder == null) {
            throw new IllegalArgumentException("nativeDecoder must not be null");
        }
        this.nativeDecoder = nativeDecoder;
        this.keycloakIssuer = keycloakIssuer == null ? "" : keycloakIssuer.trim();
    }

    @Override
    public Jwt decode(String token) throws JwtException {
        if (!keycloakIssuer.isEmpty() && isKeycloakToken(token)) {
            return keycloakDecoder().decode(token);
        }
        return nativeDecoder.decode(token);
    }

    /**
     * Peeks the token's issuer claim WITHOUT verifying the signature and reports
     * whether it matches the configured Keycloak issuer.  Any parsing error is
     * treated as "not a Keycloak token" so the native decoder gets a chance to
     * produce the proper validation error.
     */
    private boolean isKeycloakToken(String token) {
        try {
            String issuer = SignedJWT.parse(token).getJWTClaimsSet().getIssuer();
            return keycloakIssuer.equals(issuer);
        } catch (Exception ex) {
            return false;
        }
    }

    private JwtDecoder keycloakDecoder() {
        JwtDecoder decoder = keycloakDecoder;
        if (decoder == null) {
            synchronized (this) {
                decoder = keycloakDecoder;
                if (decoder == null) {
                    log.info("Initializing Keycloak JWT decoder for issuer {}", keycloakIssuer);
                    decoder = NimbusJwtDecoder.withIssuerLocation(keycloakIssuer).build();
                    keycloakDecoder = decoder;
                }
            }
        }
        return decoder;
    }
}
