package com.gateway.runtime.config;

import com.gateway.common.auth.DualIssuerJwtDecoder;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;

/**
 * Spring Security configuration for the Gateway Runtime.
 *
 * <p>The gateway does <b>not</b> rely on Spring Security for authentication —
 * it uses its own {@code GatewayAuthFilter} in the servlet filter pipeline.
 * This configuration exists solely to disable Spring Security's default
 * behaviour (form login, CSRF, session management) that would otherwise
 * interfere with transparent proxying.</p>
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Value("${gateway.identity.jwt.key-store-password:changeit}")
    private String signingSecret;

    @Value("${gateway.keycloak.issuer-uri:${JWT_KEYCLOAK_ISSUER_URI:}}")
    private String keycloakIssuer;

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .sessionManagement(session -> session
                        .sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))
                .authorizeHttpRequests(auth -> auth
                        .anyRequest().permitAll());

        return http.build();
    }

    /**
     * HMAC-SHA256 JwtDecoder matching the identity-service's JwtTokenProvider signing key.
     * This replaces the auto-configured OIDC/RSA decoder from issuer-uri.
     */
    @Bean
    public JwtDecoder jwtDecoder() {
        byte[] keyBytes = deriveKey(signingSecret);
        SecretKey secretKey = new SecretKeySpec(keyBytes, "HmacSHA256");
        JwtDecoder hmac = NimbusJwtDecoder.withSecretKey(secretKey).build();
        // When a Keycloak issuer is configured, accept BOTH native identity-service
        // (HMAC) tokens and BDP Keycloak SSO tokens via issuer routing.
        if (keycloakIssuer != null && !keycloakIssuer.isBlank()) {
            return new DualIssuerJwtDecoder(hmac, keycloakIssuer);
        }
        return hmac;
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOriginPatterns(List.of("*"));
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"));
        configuration.setAllowedHeaders(List.of("*"));
        configuration.setExposedHeaders(List.of("*"));
        configuration.setAllowCredentials(true);
        configuration.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }

    private static byte[] deriveKey(String secret) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return digest.digest(secret.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }
}
