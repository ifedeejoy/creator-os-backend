#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Lumo Backend Deployment Script${NC}\n"

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ Error: gcloud CLI not found${NC}"
    echo "Install from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Get project ID
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}❌ Error: No GCP project configured${NC}"
    echo "Run: gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

echo -e "${GREEN}📍 Project:${NC} $PROJECT_ID"
echo -e "${GREEN}📍 Region:${NC} us-central1"
echo

# Build locally first to catch errors
echo -e "${YELLOW}🔨 Building TypeScript...${NC}"
npm run build
echo -e "${GREEN}✅ Build successful${NC}\n"

# Ask for confirmation
echo -e "${YELLOW}⚠️  This will:${NC}"
echo "  1. Build Docker image"
echo "  2. Push to Container Registry"
echo "  3. Deploy to Cloud Run"
echo
read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}Deployment cancelled${NC}"
    exit 0
fi

# Build and submit
echo -e "${YELLOW}🐳 Building and pushing Docker image...${NC}"
gcloud builds submit --tag gcr.io/$PROJECT_ID/lumo-backend

echo -e "${GREEN}✅ Image pushed to gcr.io/$PROJECT_ID/lumo-backend${NC}\n"

# Deploy to Cloud Run
echo -e "${YELLOW}☁️  Deploying to Cloud Run...${NC}"
gcloud run deploy lumo-backend \
  --image gcr.io/$PROJECT_ID/lumo-backend \
  --platform managed \
  --region us-central1 \
  --port 8080 \
  --memory 4Gi \
  --cpu 2 \
  --timeout 300s \
  --min-instances 1 \
  --max-instances 10 \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production,SCRAPER_HEADLESS=true"

# Get service URL
SERVICE_URL=$(gcloud run services describe lumo-backend --region us-central1 --format 'value(status.url)')

echo
echo -e "${GREEN}✅ Deployment complete!${NC}"
echo
echo -e "${GREEN}🌐 Service URL:${NC} $SERVICE_URL"
echo
echo -e "${YELLOW}📊 Check health:${NC}"
echo "  curl $SERVICE_URL/health"
echo
echo -e "${YELLOW}📋 View logs:${NC}"
echo "  gcloud run services logs tail lumo-backend --region us-central1"
echo
echo -e "${GREEN}🎉 Backend is live!${NC}"
