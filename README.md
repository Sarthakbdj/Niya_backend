# Niya Backend 🤖

A comprehensive AI-powered backend system for conversational AI assistants with multiple personas including therapist, dietician, career counselor, and companion AI.

## 🌟 Features

- **Multi-Persona AI System**: Therapist, Dietician, Career Counselor, and Priya (Companion AI)
- **Real-time WebSocket Communication**: Instant messaging with typing indicators
- **RESTful API**: Complete CRUD operations for chats and messages
- **JWT Authentication**: Secure user authentication with Google OAuth
- **Database Integration**: PostgreSQL with Prisma ORM
- **AI Integration**: Supports external AI services (Letta AI) with intelligent fallbacks
- **Anti-Repetition System**: Prevents repetitive responses for natural conversations
- **Conversation Context**: Maintains conversation history for contextual responses

## 🛠️ Tech Stack

- **Framework**: NestJS
- **Database**: PostgreSQL (Supabase)
- **ORM**: Prisma
- **Authentication**: JWT + Google OAuth
- **Real-time**: Socket.IO
- **AI Integration**: Letta AI + Custom Persona System
- **Language**: TypeScript

## 🚀 Quick Start

### Prerequisites

- Node.js (v18+)
- PostgreSQL database
- npm/yarn

### Installation

1. **Clone the repository**

```bash
git clone https://github.com/yourusername/Niya_Backend.git
cd Niya_Backend
```

2. **Install dependencies**

```bash
npm install
```

3. **Environment Setup**
   Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

4. **Database Setup**

```bash
npx prisma generate
npx prisma db push
```

5. **Start Development Server**

```bash
npm run start:dev
```

The server will start on:

- **API Server**: http://localhost:3002
- **WebSocket Server**: http://localhost:3001

## 📡 API Endpoints

### Authentication

- `POST /auth/google` - Google OAuth authentication
- `POST /auth/refresh` - Refresh JWT token

### Chats

- `GET /chats` - Get all user chats
- `POST /chats` - Create new chat
- `GET /chats/:chatId` - Get specific chat
- `DELETE /chats/:chatId` - Delete chat

### Messages

- `POST /chats/:chatId/messages` - Send message
- `GET /chats/:chatId/messages` - Get chat messages
- `POST /chats/:chatId/messages/read` - Mark messages as read

### WebSocket Events

- `message` - Send/receive messages
- `typing` - Typing indicators
- `connected` - Connection confirmation
- `error` - Error handling

## 🤖 AI Personas

### 1. Therapist

- Empathetic and supportive responses
- Mental health guidance
- Active listening approach
- Anxiety and stress management

### 2. Dietician

- Nutrition and fitness advice
- Meal planning suggestions
- Health goal setting
- Exercise recommendations

### 3. Career Counselor

- Professional development guidance
- Resume and interview help
- Career planning assistance
- Skill development advice

### 4. Priya (Companion AI)

- Caring and loving personality
- Emotional support
- Conversational companion
- Relationship-like interactions

## 🔧 Development

### Project Structure

```
src/
├── ai-personas/          # AI persona configurations
├── auth/                 # Authentication module
├── chat/                 # Chat and messaging system
├── prisma/              # Database configuration
├── user/                # User management
└── main.ts              # Application entry point
```

### Key Components

- **ChatGateway**: WebSocket connection handling
- **ChatService**: Business logic for messaging
- **ChatController**: REST API endpoints
- **AiPersonasService**: AI persona management
- **WebSocketService**: Real-time communication

### Scripts

```bash
npm run start:dev    # Development server
npm run build        # Production build
npm run test         # Run tests
npm run test:e2e     # End-to-end tests
npx prisma studio    # Database browser
```

## 🌐 WebSocket Connection

Connect to WebSocket server:

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001/ws', {
  query: { token: 'your_jwt_token' },
  transports: ['websocket', 'polling'],
});

socket.on('connected', (data) => {
  console.log('Connected:', data);
});

socket.emit('message', {
  type: 'message',
  data: {
    chatId: 'chat_id',
    content: 'Hello!',
    agentId: 'therapist',
    messageId: 'unique_id',
  },
});
```

## 🔒 Security Features

- JWT token authentication
- CORS protection
- Rate limiting on WebSocket connections
- Input validation and sanitization
- Secure database connections
- Google OAuth integration

## 📊 Monitoring

- Health check endpoint: `GET /chats/ws/health`
- Connection statistics available
- Comprehensive error logging
- WebSocket connection tracking

## 🚨 Error Handling

The system includes comprehensive error handling:

- Graceful WebSocket disconnections
- AI service fallbacks
- Database connection recovery
- Detailed error logging

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

This project is licensed under the MIT License.

## �� Support

For support and questions:

- Create an issue in the repository
- Check the documentation
- Review the API endpoints

---

**Built with ❤️ for intelligent conversations**
