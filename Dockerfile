FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY index.html ./
COPY checkout.html ./
COPY admin.html ./
COPY signup.html ./
COPY login.html ./
COPY product.html ./
COPY mypage.html ./
COPY terms.html ./
COPY privacy.html ./
COPY shipping.html ./
COPY customer.html ./
COPY start-elin.bat ./
COPY README.md ./

ENV PORT=4173
EXPOSE 4173

CMD ["node", "server.js"]
