# For a Docker Space (use this instead of app.py/requirements.txt). It installs the
# service from the fork; "Factory rebuild" in the Space settings picks up changes.
FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir "openstock-analyst @ git+https://github.com/C-Anish-Kumar/OpenStock#subdirectory=analyst-service"
RUN useradd --create-home --uid 1000 app
USER app
EXPOSE 7860
CMD ["openstock-analyst"]
