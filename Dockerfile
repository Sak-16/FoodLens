FROM python:3.11-slim

# pytesseract needs the tesseract-ocr binary itself (not just the pip
# wrapper). requirements.txt now installs opencv-python-headless, which
# (unlike opencv-python) doesn't need libgl1 — one less thing to install
# and a bit less memory used on a free-tier instance.
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY . .

WORKDIR /app/backend

ENV PORT=10000
EXPOSE 10000

CMD ["sh", "-c", "gunicorn app:app --bind 0.0.0.0:$PORT --timeout 180"]

