FROM public.ecr.aws/lambda/nodejs:22
WORKDIR ${LAMBDA_TASK_ROOT}

RUN dnf install -y \
nss \
atk \
at-spi2-atk \
cups \
libdrm \
nspr \
brotli \
tar \
xz \
alsa-lib-devel \
libXdamage \
libXrandr \
libgbm \
pango \
libXcomposite

RUN npx --yes playwright install chromium

COPY package.json  ./
RUN npm install --omit=dev
COPY dist/ ./

ARG HOME=/tmp

CMD [ "index.handler" ]