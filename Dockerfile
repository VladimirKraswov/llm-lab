# Stage 1: Build the frontend
FROM node:20-slim AS frontend-builder
WORKDIR /app/web
COPY web/package*.json ./
RUN npm install
COPY web/ ./
RUN npm run build

# Stage 2: Final image
# Using devel image to ensure nvcc is available for training (JIT kernels)
FROM nvidia/cuda:12.4.1-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production

RUN apt-get update && apt-get install -y \
    curl \
    git \
    python3.11 \
    python3.11-venv \
    python3-pip \
    build-essential \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Link python3 to python3.11
RUN ln -sf /usr/bin/python3.11 /usr/bin/python3

WORKDIR /app

# Create venv and install python deps
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements/ /app/requirements/

# Install requirements
RUN pip install --upgrade pip setuptools wheel && \
    pip install -r requirements/ml_env.txt && \
    pip install -r requirements/quant_env.txt && \
    pip install -r requirements/transformers_env.txt

# Copy backend code
COPY package*.json ./
RUN npm install --omit=dev

COPY src/ ./src/
COPY scripts/ ./scripts/

# Copy built frontend from Stage 1
COPY --from=frontend-builder /app/web/dist ./web/dist

# Default configuration
ENV WORKSPACE=/workspace \
    ML_ENV=/opt/venv \
    QUANTIZE_ENV=/opt/venv \
    TRANSFORMERS_ENV=/opt/venv \
    SVC_PORT=8787 \
    SVC_HOST=0.0.0.0

# Create workspace directory
RUN mkdir -p /workspace

EXPOSE 8787

ENTRYPOINT ["node", "src/server.js"]
