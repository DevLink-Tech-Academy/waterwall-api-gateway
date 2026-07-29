package com.gateway.common.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * Extracts and validates a JWT from the {@code Authorization: Bearer <token>} header.
 * <p>
 * On success a {@link GatewayAuthentication} is placed into the
 * {@link SecurityContextHolder}.  On any error the filter simply continues the
 * chain so that Spring Security's own entry-point handling can return a proper
 * 401 response.
 */
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(JwtAuthenticationFilter.class);
    private static final String AUTHORIZATION_HEADER = "Authorization";
    private static final String BEARER_PREFIX = "Bearer ";

    private final JwtDecoder jwtDecoder;
    /**
     * The trusted Keycloak issuer (same value configured on the resource server via
     * {@code ${gateway.keycloak.issuer-uri:${JWT_KEYCLOAK_ISSUER_URI:}}}). Only tokens
     * whose {@code iss} exactly matches this are allowed the admin→SUPER_ADMIN
     * elevation. Blank/null disables elevation entirely.
     */
    private final String keycloakIssuer;

    /**
     * Backwards-compatible constructor — no Keycloak issuer configured, so the
     * admin→SUPER_ADMIN elevation is never applied (used by identity-service).
     */
    public JwtAuthenticationFilter(JwtDecoder jwtDecoder) {
        this(jwtDecoder, null);
    }

    public JwtAuthenticationFilter(JwtDecoder jwtDecoder, String keycloakIssuer) {
        this.jwtDecoder = jwtDecoder;
        this.keycloakIssuer = keycloakIssuer == null ? "" : keycloakIssuer.trim();
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {

        String token = extractToken(request);

        if (token == null) {
            // No JWT present — allow chain to continue (anonymous access)
            filterChain.doFilter(request, response);
            return;
        }

        try {
            Jwt jwt = jwtDecoder.decode(token);

            String userId = jwt.getSubject();
            String orgId = claimAsString(jwt, "org_id");
            String email = claimAsString(jwt, "email");
            List<String> permissions = claimAsStringList(jwt, "permissions");
            String appId = claimAsString(jwt, "app_id");
            String scope = claimAsString(jwt, "scope");

            // Keycloak tokens carry roles under realm_access.roles, not a top-level
            // "roles" claim. Native identity-service tokens have no realm_access, so they
            // keep the existing top-level path untouched.
            List<String> roles;
            List<String> realmRoles = extractRealmAccessRoles(jwt);
            if (realmRoles != null) {
                roles = new ArrayList<>(realmRoles);
                // SUPER_ADMIN elevation only for tokens from the configured Keycloak issuer,
                // exact-case "admin" (Keycloak roles are case-sensitive). Never for native
                // identity-service tokens (no realm_access) or any other issuer. NOTE: a
                // dedicated realm role (e.g. bdp-gateway-superadmin) would be tighter if the
                // BDP realm later defines one; "admin" is today's platform-admin role.
                boolean fromConfiguredKc = !keycloakIssuer.isBlank()
                        && jwt.getIssuer() != null
                        && keycloakIssuer.equals(jwt.getIssuer().toString());
                if (fromConfiguredKc && roles.contains("admin") && !roles.contains("SUPER_ADMIN")) {
                    roles.add("SUPER_ADMIN");
                }
            } else {
                roles = claimAsStringList(jwt, "roles");
            }

            GatewayAuthentication authentication =
                    new GatewayAuthentication(userId, orgId, email, roles, permissions, appId, scope);

            SecurityContextHolder.getContext().setAuthentication(authentication);
        } catch (JwtException ex) {
            log.debug("JWT validation failed: {}", ex.getMessage());
            // Let Spring Security handle the 401
        } catch (Exception ex) {
            log.warn("Unexpected error during JWT processing", ex);
        }

        filterChain.doFilter(request, response);
    }

    private String extractToken(HttpServletRequest request) {
        String header = request.getHeader(AUTHORIZATION_HEADER);
        if (header != null && header.startsWith(BEARER_PREFIX)) {
            String token = header.substring(BEARER_PREFIX.length()).trim();
            return token.isEmpty() ? null : token;
        }
        return null;
    }

    /**
     * Extracts the {@code realm_access.roles} list from a Keycloak token.
     * Returns {@code null} when the token has no {@code realm_access} claim (i.e. it
     * is a native identity-service token), so callers can fall back to the legacy
     * top-level {@code roles} claim. Null-safe throughout.
     */
    @SuppressWarnings("unchecked")
    private static List<String> extractRealmAccessRoles(Jwt jwt) {
        Object realmAccess = jwt.getClaim("realm_access");
        if (!(realmAccess instanceof Map<?, ?> map)) {
            return null;
        }
        Object rolesValue = map.get("roles");
        if (rolesValue instanceof List<?> list) {
            return list.stream()
                    .filter(java.util.Objects::nonNull)
                    .map(Object::toString)
                    .toList();
        }
        return Collections.emptyList();
    }

    private static String claimAsString(Jwt jwt, String claim) {
        Object value = jwt.getClaim(claim);
        return value != null ? value.toString() : null;
    }

    @SuppressWarnings("unchecked")
    private static List<String> claimAsStringList(Jwt jwt, String claim) {
        Object value = jwt.getClaim(claim);
        if (value instanceof List<?> list) {
            return list.stream()
                    .map(Object::toString)
                    .toList();
        }
        if (value instanceof String str) {
            // Some IdPs encode roles/permissions as a space-delimited string
            return str.isBlank() ? Collections.emptyList() : List.of(str.split("\\s+"));
        }
        return Collections.emptyList();
    }
}
