# Optional baked Playwright environment for containerized E2E runs.
#
# Node 22 (matches .nvmrc), all browsers, xvfb and system deps are already
# present in this base image, so the build never runs `playwright install
# --with-deps` (which would need root/apt at runtime). Pinned to our
# @playwright/test version — keep this tag in sync with vip-workflows's
# devDependency.
#
# The build mounts the checkout at /app and runs as the agent user
# (docker run --user "$(id -u):$(id -g)"), so no files are baked in here.
FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /app
