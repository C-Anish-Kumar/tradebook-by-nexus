# For a Docker Space (use this instead of the Gradio app.py). Place it in the folder that
# space/build.py produces: it installs from the copied files, not from GitHub (the repo is private).
FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY openstock_analyst ./openstock_analyst
RUN useradd --create-home --uid 1000 app
USER app
EXPOSE 7860
CMD ["python", "-m", "openstock_analyst.server"]
