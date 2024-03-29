# Learn about building .NET container images:
# https://github.com/dotnet/dotnet-docker/blob/main/samples/README.md
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:8.0 AS build
ARG TARGETARCH
WORKDIR /source

# -- copy csproj and restore as distinct layers
COPY *.csproj .
RUN dotnet restore -a $TARGETARCH

# -- copy and publish app and libraries
COPY . .
RUN dotnet publish -a $TARGETARCH --no-restore -o /app

# final stage/image
FROM mcr.microsoft.com/dotnet/aspnet:8.0

# -- Enables the app to read the kerberos token where credentials fetcher stores it.
RUN apt-get update
RUN apt-get install krb5-user curl -y
ENV KRB5CCNAME=/var/credentials-fetcher/krbdir/krb5cc

# -- Copy the app, open ports and set the entry point
WORKDIR /app
COPY --from=build /app .
EXPOSE 8080
ENTRYPOINT ["dotnet", "web-app.dll"]