FROM node:20-slim

# Install common build dependencies and system packages
# RUN apt-get update && apt-get install -y \
#     python3 \
#     make \
#     g++ \
#     git \
#     curl \
#     && rm -rf /var/lib/apt/lists/*

# Install pnpm globally (commonly used in tutorials)
RUN npm install -g pnpm

# Install Playwright globally for browser testing
RUN npm install -g playwright
RUN npx playwright install --with-deps chromium

# Set working directory
WORKDIR /workspace

# Default command (can be overridden)
CMD ["/bin/bash"]

