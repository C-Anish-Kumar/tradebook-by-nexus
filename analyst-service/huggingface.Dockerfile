# Paste this as the `Dockerfile` of a Hugging Face Docker Space. It builds the
# service from your OpenStock fork; use "Factory rebuild" in the Space settings
# to pick up changes pushed to the fork.
FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/C-Anish-Kumar/OpenStock /tmp/src \
 && cp -r /tmp/src/analyst-service /service && rm -rf /tmp/src
WORKDIR /service
RUN pip install --no-cache-dir -r requirements.txt
RUN useradd --create-home --uid 1000 app
USER app
ENV PYTHONUNBUFFERED=1
EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
