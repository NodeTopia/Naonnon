FROM   node:13-alpine
RUN apk update && apk upgrade && \
    apk add --no-cache bash git openssh

RUN mkdir /app
COPY . /app

WORKDIR /app

RUN npm install

EXPOSE 80
EXPOSE 443

CMD ["node", "/app/bin/naonnon.js" ]