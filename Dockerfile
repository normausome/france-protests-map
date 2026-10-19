FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html style.css app.js /srv/
COPY data /srv/data
