FROM alpine:3.24 AS tools
RUN apk add --no-cache ca-certificates git openssh-client python3
WORKDIR /app
COPY scripts/ /opt/bugstage-tools/
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
ENTRYPOINT ["python3", "/opt/bugstage-tools/mirror.py"]

FROM tools AS bugstage
ARG TARGETARCH=amd64
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) checksum=6eb711a54d5399e62f474d5996437756ec49bbd00d2046cbd82fb18e3675b6a7 ;; \
      arm64) checksum=549f33ef813230e5af9878e10f1de56104aea607528ede4230e7158581a927b5 ;; \
      *) exit 1 ;; \
    esac; \
    wget -q -O /tmp/bugstage.zip "https://ganigeorgiev.com/meta/bugstage/bugstage/download/v0.1.0-rc.3/bugstage_0.1.0-rc.3_linux_${TARGETARCH}.zip"; \
    printf '%s  /tmp/bugstage.zip\n' "$checksum" | sha256sum -c -; \
    unzip -q /tmp/bugstage.zip -d /app; \
    chmod 755 /app/bugstage; \
    rm /tmp/bugstage.zip
COPY pb_hooks/ /app/pb_hooks/
ENTRYPOINT ["python3", "/opt/bugstage-tools/start.py"]
