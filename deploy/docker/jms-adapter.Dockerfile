FROM maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY services/jms-adapter/pom.xml .
RUN mvn -q -DskipTests dependency:go-offline
COPY services/jms-adapter/src ./src
RUN mvn -q -DskipTests package

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=build /src/target/jms-adapter-1.0.0.jar /app/jms-adapter.jar
RUN addgroup -S app && adduser -S -G app app
USER app
EXPOSE 8091
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=70", "-jar", "/app/jms-adapter.jar"]
