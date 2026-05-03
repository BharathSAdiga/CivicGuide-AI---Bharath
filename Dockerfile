FROM python:3.10-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

# Set the working directory to the backend so the python commands run from there
WORKDIR /app/backend

# Install system dependencies needed for sentence-transformers
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy backend requirements and install
COPY backend/requirements.txt .
# Add gunicorn for production serving
RUN pip install --no-cache-dir -r requirements.txt gunicorn

# Copy all project files into the container
COPY . /app

# Pre-download the sentence-transformer models to the Docker image so it starts up instantly
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

# Expose the Cloud Run port
EXPOSE 8080

# Command to run the application using Gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "1", "--threads", "8", "--timeout", "0", "app:create_app()"]
