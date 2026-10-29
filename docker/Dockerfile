# Stage 1: Build React + TypeScript + Vite Frontend
FROM node:20-alpine AS frontend-build
WORKDIR /workspace/frontend
COPY frontend/package*.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# Stage 2: Build Java 17 + Spring Boot Backend JAR with Maven
FROM maven:3.9.9-eclipse-temurin-17 AS backend-build
WORKDIR /workspace/backend
COPY backend/pom.xml ./
RUN mvn dependency:go-offline -B
COPY backend/src ./src
COPY --from=frontend-build /workspace/backend/src/main/resources/static ./src/main/resources/static
RUN mvn clean package -DskipTests -B

# Stage 3: Production Runtime (JRE 17)
FROM eclipse-temurin:17-jre
WORKDIR /app
ENV TZ=UTC
RUN mkdir -p /data/files
COPY --from=backend-build /workspace/backend/target/vtc-portal-2.0.0.jar /app/app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
