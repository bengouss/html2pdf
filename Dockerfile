FROM public.ecr.aws/lambda/nodejs:22
WORKDIR ${LAMBDA_TASK_ROOT}

RUN dnf install -y nss atk at-spi2-atk cups libdrm nspr brotli tar

COPY package.json  ./
RUN npm install --omit=dev
COPY dist/ ./
# RUN brotli --decompress node_modules/\@sparticuz/chromium/bin/chromium.br -o /tmp/chromium
# COPY pki_nssdb.tgz ${LAMBDA_TASK_ROOT}
# RUN mkdir -p /root
# RUN touch /root/test
# RUN tar -xzf pki_nssdb.tgz -C /root/

# RUN mkdir -p /root/.pki/nssdb
# COPY .pki/nssdb/cert9.db /root/.pki/nssdb/cert9.db
# COPY .pki/nssdb/key4.db /root/.pki/nssdb/key4.db
# COPY .pki/nssdb/pkcs11.txt /root/.pki/nssdb/pkcs11.txt

# Copy function code
# COPY lambda.js ${LAMBDA_TASK_ROOT}
# COPY puppeteer.js ${LAMBDA_TASK_ROOT}
# COPY express.js ${LAMBDA_TASK_ROOT}
# COPY utils.js ${LAMBDA_TASK_ROOT}

# COPY package.json dist/  ./
# RUN npm install --omit=dev

ARG HOME=/tmp

# Set the CMD to your handler (could also be done as a parameter override outside of the Dockerfile)
CMD [ "index.handler" ]