import { Injectable, Logger } from '@nestjs/common';
import { Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { SocketMessage, ConnectionInfo } from './interfaces/socket.interface';

@Injectable()
export class WebSocketService {
  private readonly logger = new Logger(WebSocketService.name);
  private connections = new Map<string, ConnectionInfo>();
  private chatRooms = new Map<string, Set<string>>();
  private rateLimiter = new Map<string, { count: number; resetTime: number }>();

  constructor(
    private readonly chatService: ChatService,
    private readonly prisma: PrismaService,
  ) {}

  addConnection(connectionId: string, connectionInfo: ConnectionInfo) {
    this.connections.set(connectionId, connectionInfo);
    this.logger.log(
      `Connection added: ${connectionId} for user ${connectionInfo.userId}`,
    );
  }

  removeConnection(connectionId: string) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    // Leave all chat rooms
    connection.joinedChats.forEach((chatId) => {
      this.leaveChatRoom(connectionId, chatId);
    });

    // Remove connection
    this.connections.delete(connectionId);
    this.logger.log(`Connection removed: ${connectionId}`);
  }

  updateLastPing(connectionId: string) {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.lastPing = Date.now();
    }
  }

  async handleMessage(client: Socket, payload: any): Promise<boolean> {
    try {
      const connection = this.connections.get(client.id);
      if (!connection) {
        this.sendError(client, 'Connection not found');
        return false;
      }

      // Rate limiting
      if (!this.checkRateLimit(connection.userId, 'message')) {
        this.sendError(client, 'Rate limit exceeded');
        return false;
      }

      const { chatId, content, agentId, messageId } = payload.data;

      // Validate message format
      if (!chatId || !content || !agentId) {
        this.sendError(client, 'Invalid message format');
        return false;
      }

      // Check if user has access to chat
      const chat = await this.prisma.chat.findFirst({
        where: { id: chatId, userId: connection.userId },
      });

      if (!chat) {
        this.sendError(client, 'Access denied to chat');
        return false;
      }

      console.log(`=== WEBSOCKET MESSAGE DEBUG ===`);
      console.log(
        `Processing message for chatId: ${chatId}, agentId: ${agentId}`,
      );
      console.log(`User message content: ${content}`);
      console.log(`User ID: ${connection.userId}`);

      // Show typing indicator for AI immediately
      client.emit('typing', {
        type: 'typing',
        data: {
          chatId,
          agentId,
          isTyping: true,
        },
        timestamp: Date.now(),
      });

      // Process message through chat service (which saves user message and generates AI response)
      const aiResponse = await this.chatService.sendMessage(
        chatId,
        connection.userId,
        { content, agentId },
      );

      console.log(
        `AI Response received: ${aiResponse.content.substring(0, 100)}...`,
      );

      // Get the user message that was just saved
      const userMessage = await this.prisma.message.findFirst({
        where: {
          chatId,
          userId: connection.userId,
          content,
          role: 'user',
        },
        orderBy: { timestamp: 'desc' },
      });

      // Send user message (confirmed version)
      if (userMessage) {
        console.log(`Sending user message: ${userMessage.content}`);
        client.emit('message', {
          type: 'message',
          data: {
            chatId,
            message: {
              id: userMessage.id,
              chatId: userMessage.chatId,
              userId: userMessage.userId.toString(),
              agentId: userMessage.agentId,
              content: userMessage.content,
              role: userMessage.role,
              timestamp: userMessage.timestamp.toISOString(),
              metadata: {
                ...(userMessage.metadata as object),
                confirmed: true,
              },
            },
            messageId,
            confirmed: true,
          },
          timestamp: Date.now(),
          messageId,
        });
      }

      // Stop typing indicator
      client.emit('typing', {
        type: 'typing',
        data: {
          chatId,
          agentId,
          isTyping: false,
        },
        timestamp: Date.now(),
      });

      // Send AI response after a brief delay for better UX
      setTimeout(() => {
        console.log(
          `Sending AI response: ${aiResponse.content.substring(0, 50)}...`,
        );
        client.emit('message', {
          type: 'message',
          data: {
            chatId,
            message: {
              id: aiResponse.id,
              chatId: aiResponse.chatId,
              userId: aiResponse.userId.toString(),
              agentId: aiResponse.agentId,
              content: aiResponse.content,
              role: aiResponse.role,
              timestamp: aiResponse.timestamp.toISOString(),
              metadata: aiResponse.metadata,
            },
            messageId: `${messageId}_ai`,
          },
          timestamp: Date.now(),
          messageId: `${messageId}_ai`,
        });
      }, 800); // Slightly longer delay for better UX

      return true;
    } catch (error) {
      this.logger.error('Message handling error:', error);
      this.sendError(client, 'Failed to process message');

      // Stop typing indicator on error
      const { chatId, agentId } = payload.data || {};
      if (chatId && agentId) {
        client.emit('typing', {
          type: 'typing',
          data: {
            chatId,
            agentId,
            isTyping: false,
          },
          timestamp: Date.now(),
        });
      }

      return false;
    }
  }

  async handleTyping(client: Socket, payload: any): Promise<boolean> {
    try {
      const connection = this.connections.get(client.id);
      if (!connection) {
        this.sendError(client, 'Connection not found');
        return false;
      }

      const { chatId, agentId, isTyping } = payload.data;

      // Validate typing event
      if (!chatId || !agentId || typeof isTyping !== 'boolean') {
        this.sendError(client, 'Invalid typing event format');
        return false;
      }

      // Check if user has access to chat
      const chat = await this.prisma.chat.findFirst({
        where: { id: chatId, userId: connection.userId },
      });

      if (!chat) {
        this.sendError(client, 'Access denied to chat');
        return false;
      }

      // Broadcast typing event to chat room
      this.broadcastToChat(chatId, {
        type: 'typing',
        data: {
          chatId,
          userId: connection.userId.toString(),
          agentId,
          isTyping,
        },
        timestamp: Date.now(),
      });

      return true;
    } catch (error) {
      this.logger.error('Typing handling error:', error);
      this.sendError(client, 'Failed to process typing event');
      return false;
    }
  }

  async handleReadReceipt(client: Socket, payload: any): Promise<boolean> {
    try {
      const connection = this.connections.get(client.id);
      if (!connection) {
        this.sendError(client, 'Connection not found');
        return false;
      }

      const { chatId, messageIds } = payload.data;

      // Validate read receipt
      if (!chatId || !messageIds || !Array.isArray(messageIds)) {
        this.sendError(client, 'Invalid read receipt format');
        return false;
      }

      // Check if user has access to chat
      const chat = await this.prisma.chat.findFirst({
        where: { id: chatId, userId: connection.userId },
      });

      if (!chat) {
        this.sendError(client, 'Access denied to chat');
        return false;
      }

      // Mark messages as read
      await this.chatService.markMessagesAsRead(chatId, connection.userId, {
        messageIds,
      });

      // Broadcast read receipt confirmation
      this.broadcastToChat(chatId, {
        type: 'read_receipt',
        data: {
          chatId,
          messageIds,
          userId: connection.userId.toString(),
          confirmed: true,
        },
        timestamp: Date.now(),
      });

      return true;
    } catch (error) {
      this.logger.error('Read receipt handling error:', error);
      this.sendError(client, 'Failed to process read receipt');
      return false;
    }
  }

  async handleChatUpdate(client: Socket, payload: any): Promise<boolean> {
    try {
      const connection = this.connections.get(client.id);
      if (!connection) {
        this.sendError(client, 'Connection not found');
        return false;
      }

      const { action, chatId } = payload.data;

      // Validate chat update
      if (!action || !chatId || !['join', 'leave'].includes(action)) {
        this.sendError(client, 'Invalid chat update format');
        return false;
      }

      // Check if user has access to chat
      const chat = await this.prisma.chat.findFirst({
        where: { id: chatId, userId: connection.userId },
      });

      if (!chat) {
        this.sendError(client, 'Access denied to chat');
        return false;
      }

      if (action === 'join') {
        this.joinChatRoom(client.id, chatId);

        // Send chat history
        // const chatHistory = await this.chatService.getChat(
        //   chatId,
        //   connection.userId,
        // );
        client.emit('chat_update', {
          type: 'chat_update',
          data: {
            chatId,
            updates: {
              title: chat.title,
              messageCount: chat.messageCount,
              lastMessage: chat.lastMessage,
            },
          },
          timestamp: Date.now(),
        });
      } else if (action === 'leave') {
        this.leaveChatRoom(client.id, chatId);
      }

      return true;
    } catch (error) {
      this.logger.error('Chat update handling error:', error);
      this.sendError(client, 'Failed to process chat update');
      return false;
    }
  }

  private joinChatRoom(connectionId: string, chatId: string) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    if (!this.chatRooms.has(chatId)) {
      this.chatRooms.set(chatId, new Set());
    }

    this.chatRooms.get(chatId)?.add(connectionId);
    connection.joinedChats.add(chatId);

    this.logger.log(`User ${connection.userId} joined chat ${chatId}`);
  }

  private leaveChatRoom(connectionId: string, chatId: string) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    const chatRoom = this.chatRooms.get(chatId);
    if (chatRoom) {
      chatRoom.delete(connectionId);
      if (chatRoom.size === 0) {
        this.chatRooms.delete(chatId);
      }
    }

    connection.joinedChats.delete(chatId);

    this.logger.log(`User ${connection.userId} left chat ${chatId}`);
  }

  private broadcastToChat(chatId: string, message: SocketMessage) {
    const chatRoom = this.chatRooms.get(chatId);
    if (!chatRoom) return;

    chatRoom.forEach((connectionId) => {
      const connection = this.connections.get(connectionId);
      if (connection && connection.ws.connected) {
        connection.ws.emit(message.type, message);
      }
    });
  }

  private sendError(client: Socket, message: string, code: number = 400) {
    client.emit('error', {
      type: 'error',
      data: { errorMessage: message, code },
      timestamp: Date.now(),
    });
  }

  private checkRateLimit(userId: number, messageType: string): boolean {
    const key = `${userId}:${messageType}`;
    const now = Date.now();
    const limit = this.rateLimiter.get(key) || {
      count: 0,
      resetTime: now + 60000,
    };

    if (now > limit.resetTime) {
      limit.count = 0;
      limit.resetTime = now + 60000;
    }

    limit.count++;
    this.rateLimiter.set(key, limit);

    return limit.count <= 100; // 100 messages per minute
  }

  getConnectionStats() {
    return {
      totalConnections: this.connections.size,
      activeChats: this.chatRooms.size,
      connections: Array.from(this.connections.keys()),
      chatRooms: Array.from(this.chatRooms.keys()),
    };
  }
}
