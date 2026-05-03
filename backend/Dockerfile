FROM python:3.10-slim

WORKDIR /app

# Install system dependencies (needed for opencv-python-headless if not completely static)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Expose the port that Cloud Run uses
EXPOSE 8080

# Cloud Run injects the PORT environment variable
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
