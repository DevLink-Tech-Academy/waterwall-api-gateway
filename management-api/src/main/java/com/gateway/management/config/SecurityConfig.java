package com.gateway.management.config;

import com.gateway.common.auth.JwtAuthenticationFilter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    @Value("${gateway.identity.jwt.key-store-password:changeit}")
    private String signingSecret;

    @Value("${gateway.cors.allowed-origins:http://localhost:3000,http://localhost:3001}")
    private List<String> allowedOrigins;

    @Value("${gateway.cors.allowed-methods:GET,POST,PUT,PATCH,DELETE,OPTIONS}")
    private List<String> allowedMethods;

    @Value("${gateway.cors.allowed-headers:Authorization,Content-Type,X-API-Key,X-Trace-Id}")
    private List<String> allowedHeaders;

    @Value("${gateway.cors.allow-credentials:true}")
    private boolean allowCredentials;

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))
                .csrf(csrf -> csrf.disable())
                .sessionManagement(session -> session
                        .sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers("/actuator/health/**").permitAll()
                        .requestMatchers("/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.POST, "/v1/webhooks/paystack").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.POST, "/v1/webhooks/stripe").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.POST, "/v1/webhooks/flutterwave").permitAll()
                        // Public read-only endpoints for the developer portal catalog
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/v1/apis", "/v1/apis/**").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/v1/plans", "/v1/plans/**").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/v1/docs/**").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/v1/governance/hub/**").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/v1/governance/specs/**").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/v1/marketplace/**").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/v1/sdks/download/**").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.POST, "/v1/sdks/generate/**").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/v1/changelogs/**").permitAll()
                        .anyRequest().authenticated()
                )
                .addFilterBefore(jwtAuthenticationFilter(), UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    @Bean
    public JwtDecoder jwtDecoder() {
        byte[] keyBytes = deriveKey(signingSecret);
        SecretKey secretKey = new SecretKeySpec(keyBytes, "HmacSHA256");
        return NimbusJwtDecoder.withSecretKey(secretKey).build();
    }

    @Bean
    public JwtAuthenticationFilter jwtAuthenticationFilter() {
        return new JwtAuthenticationFilter(jwtDecoder());
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(allowedOrigins);
        configuration.setAllowedMethods(allowedMethods);
        configuration.setAllowedHeaders(allowedHeaders);
        configuration.setAllowCredentials(allowCredentials);

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
