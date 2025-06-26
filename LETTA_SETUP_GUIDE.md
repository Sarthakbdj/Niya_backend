# 🚀 Letta Integration Setup Guide

## Overview

This guide will help you set up proper Letta token authentication for your Niya backend to work with your Python service on Render.

## 🔧 Step 1: Get Your Letta API Key

### Option A: Letta Cloud (Recommended)

1. **Sign up for Letta Cloud**: Go to [https://cloud.letta.com](https://cloud.letta.com)
2. **Create an account** or sign in
3. **Navigate to API Keys**: Go to Settings → API Keys
4. **Generate a new API key**: Click "Create API Key"
5. **Copy the key**: It will look like `letta_sk_...` or similar

## 🔑 Step 2: Update Your Environment Variables

Update your `.env` file with the proper Letta credentials:

```bash
# LETTA AI Configuration
LETTA_API_KEY=your_actual_letta_api_key_here
LETTA_BASE_URL=https://api.letta.com
```

**Important**: Replace `your_actual_letta_api_key_here` with your real Letta API key!

## 🐍 Step 3: Update Your Python Service

Your Python service needs to use the Letta credentials passed from the Node.js backend.

### Expected Request Format

Your Node.js backend now sends this payload to your Python service:

```json
{
  "message": "User's message",
  "conversation_history": [
    { "role": "user", "content": "Previous message" },
    { "role": "assistant", "content": "Previous response" }
  ],
  "system_prompt": "You are Priya...",
  "letta_api_key": "letta_sk_...",
  "letta_base_url": "https://api.letta.com"
}
```

## 🔄 Step 4: Test the Integration

### Test Configuration

```bash
curl -X POST http://localhost:3002/chats/test-bridge \
  -H "Content-Type: application/json" \
  -d '{"message": "Test Letta integration"}'
```

Look for these logs:

```
🔑 Letta API Key configured: ✅ Yes
🌐 Letta Base URL: https://api.letta.com
```

## ✅ What's Been Optimized

1. **Removed all fallbacks** - Only Letta AI responses
2. **Added proper authentication** - Letta API key and base URL
3. **Limited conversation context** - 6 messages max to prevent overload
4. **Added retry logic** - 2 attempts with 2-second delays
5. **Increased timeout** - 25 seconds for Letta responses
6. **Better error logging** - Detailed error information

## 🚨 Next Steps

1. **Get a real Letta API key** from [https://cloud.letta.com](https://cloud.letta.com)
2. **Update your `.env` file** with the real API key
3. **Update your Python service** to use the passed Letta credentials
4. **Test the integration** end-to-end
5. **Deploy to production** with proper environment variables

Your backend is now optimized for Letta token authentication!
