# MAVERIX - Mensajes Masivos. Sin dependencias npm, imagen minima.
FROM node:20-alpine
WORKDIR /app
COPY server.js index.html admin.html favicon.svg favicon-256.png og-image.png rifa.jpeg ./
ENV PORT=3000 DATA_DIR=/data
EXPOSE 3000
# Healthcheck: si /healthz no responde 3 veces seguidas, EasyPanel reinicia el contenedor
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server.js"]
