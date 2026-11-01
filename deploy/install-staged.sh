#!/usr/bin/env bash
# Run as root after uploading the reviewed release, runtime, fonts and server.env.
set -euo pipefail
stage=/root/ai-tender-stage
revision=${1:?commit required}
[[ "$revision" =~ ^[a-f0-9]{40}$ ]] || exit 2
release=/opt/ai-tender/releases/$revision
install -d /opt/ai-tender/releases /opt/ai-tender/runtime /etc/ai-tender
if ! id ai-tender >/dev/null 2>&1; then
    useradd --system --user-group --home-dir /var/lib/ai-tender --shell /usr/sbin/nologin ai-tender
fi
install -d -o ai-tender -g ai-tender -m 700 /var/lib/ai-tender /var/lib/ai-tender/uploads
install -d "$release"
tar -xzf "$stage/source.tar.gz" -C "$release" --no-same-owner
tar -xJf "$stage/node-linux.tar.xz" -C /opt/ai-tender/runtime --strip-components=1 --no-same-owner
export PATH=/opt/ai-tender/runtime/bin:$PATH
node --version
npm ci --prefix "$release/server" --omit=dev --ignore-scripts --no-audit --no-fund
install -d /usr/local/share/fonts/fandol
install -m 644 "$stage/fonts/"* /usr/local/share/fonts/fandol/
install -m 600 "$stage/server.env" /etc/ai-tender/server.env
ln -sfn "$release" /opt/ai-tender/current
install -m 644 "$release/deploy/ai-tender.service" /etc/systemd/system/ai-tender.service
install -m 644 "$release/deploy/nginx-loopback.conf" /etc/nginx/sites-available/ai-tender-local
ln -sfn /etc/nginx/sites-available/ai-tender-local /etc/nginx/sites-enabled/ai-tender-local
# Only the untouched default site from this fresh Nginx installation is disabled.
if [[ -L /etc/nginx/sites-enabled/default ]]; then
    mv /etc/nginx/sites-enabled/default "$stage/nginx-default-link"
fi
nginx -t
systemctl daemon-reload
systemctl enable --now ai-tender
systemctl restart ai-tender
systemctl reload nginx
for attempt in $(seq 1 20); do
    if curl -fsS http://127.0.0.1:8080/v1/health; then
        printf '\nDeployment healthy\n'
        exit 0
    fi
    sleep 1
done
systemctl status ai-tender --no-pager
exit 1
