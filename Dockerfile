FROM node:alpine AS build

WORKDIR /src

COPY index.html ./

RUN npm --global --silent --no-update-notifier --no-fund install html-minifier-terser@latest \
  && mkdir -p /out \
  && html-minifier-terser \
    --collapse-whitespace \
    --remove-comments \
    --minify-css true \
    --minify-js true \
    --remove-redundant-attributes \
    --remove-script-type-attributes \
    --remove-style-link-type-attributes \
    --use-short-doctype \
    --output /out/index.html \
    /src/index.html

FROM node:alpine

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8788
ENV IMAGEFETCH_RUNTIME=container

WORKDIR /app

COPY --from=build /out/index.html ./index.html
COPY server.js start.sh VERSION ./
RUN chmod +x /app/start.sh

EXPOSE 8788

CMD ["/app/start.sh"]
