FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1000 app
WORKDIR /home/app/service
COPY pyproject.toml .
COPY openstock_analyst openstock_analyst
RUN pip install --no-cache-dir .

USER app
EXPOSE 7860
CMD ["openstock-analyst"]
