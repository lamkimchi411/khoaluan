FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y python3 python3-venv && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev
COPY python/requirements.txt ./python/requirements.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r python/requirements.txt && /opt/venv/bin/playwright install --with-deps chromium
ENV PATH="/opt/venv/bin:$PATH"
COPY server ./server
COPY python ./python
EXPOSE 3001
CMD ["node", "server/index.js"]
