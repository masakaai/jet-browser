FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod 755 /app /app/entrypoint.sh && chown -R pwuser:pwuser /app
USER root
ENTRYPOINT ["/app/entrypoint.sh"]
