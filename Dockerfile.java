##############################################
# Stage 1: Resolve Maven dependencies (cached)
##############################################
FROM maven:3.9-eclipse-temurin-21-alpine AS deps
WORKDIR /build

# Copy only POMs for dependency caching
COPY pom.xml .
COPY common/common-dto/pom.xml common/common-dto/
COPY common/common-logging/pom.xml common/common-logging/
COPY common/common-events/pom.xml common/common-events/
COPY common/common-cache/pom.xml common/common-cache/
COPY common/common-auth/pom.xml common/common-auth/
COPY identity-service/pom.xml identity-service/
COPY management-api/pom.xml management-api/
COPY gateway-runtime/pom.xml gateway-runtime/
COPY analytics-service/pom.xml analytics-service/
COPY notification-service/pom.xml notification-service/

RUN --mount=type=cache,target=/root/.m2 \
    mvn dependency:go-offline -B -q || true

##############################################
# Stage 2: Build the target service
##############################################
FROM deps AS build
ARG SERVICE_NAME

COPY common/ common/
COPY ${SERVICE_NAME}/ ${SERVICE_NAME}/

RUN --mount=type=cache,target=/root/.m2 \
    mvn clean package -pl ${SERVICE_NAME} -am -DskipTests -B -q

##############################################
# Stage 3: Minimal runtime image
##############################################
FROM eclipse-temurin:21-jre-alpine AS runtime
ARG SERVICE_NAME
ARG SERVICE_PORT=8080

RUN addgroup -S gateway && adduser -S gateway -G gateway
WORKDIR /app

COPY --from=build /build/${SERVICE_NAME}/target/${SERVICE_NAME}-*.jar app.jar
RUN chown -R gateway:gateway /app

USER gateway
EXPOSE ${SERVICE_PORT}

ENTRYPOINT ["java", "-jar", "app.jar"]
