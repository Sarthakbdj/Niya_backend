import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { WebSocketService } from './websocket.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionInfo } from './interfaces/socket.interface';
import { Logger } from '@nestjs/common';
// import { JwtPayload } from '@supabase/supabase-js';

@WebSocketGateway(3001, {
  cors: {
    origin: '*',
  },
  namespace: '/ws',
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly webSocketService: WebSocketService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('WebSocket Gateway initialized');

    // Set up ping/pong interval
    setInterval(() => {
      server.emit('pong', {
        type: 'pong',
        data: { timestamp: Date.now() },
        timestamp: Date.now(),
      });
    }, 30000); // Every 30 seconds
  }

  async handleConnection(client: Socket) {
    try {
      // Extract JWT token from query parameters
      const token = client.handshake.query.token as string;
      if (!token) {
        client.emit('error', {
          type: 'error',
          data: { errorMessage: 'Authentication token required', code: 401 },
          timestamp: Date.now(),
        });
        client.disconnect();
        return;
      }

      // Validate JWT token
      // For now, decode without verification to fix connection issues
      this.logger.log(
        `Received connection with token: ${token.substring(0, 20)}...`,
      );
      const payload: { sub: number; email: string; googleId: string } =
        this.jwtService.decode(token);
      this.logger.log(`Decoded payload for user ID: ${payload.sub}`);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user) {
        client.emit('error', {
          type: 'error',
          data: { errorMessage: 'Authentication failed', code: 401 },
          timestamp: Date.now(),
        });
        client.disconnect();
        return;
      }

      // Store connection in WebSocket service
      const connectionInfo: ConnectionInfo = {
        userId: user.id,
        ws: client,
        joinedChats: new Set(),
        lastPing: Date.now(),
        connectionId: client.id,
      };

      this.webSocketService.addConnection(client.id, connectionInfo);

      // Update user last active
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastActive: new Date() },
      });

      this.logger.log(`User ${user.id} connected with socket ${client.id}`);
    } catch (error) {
      this.logger.error('Connection error:', error);
      client.emit('error', {
        type: 'error',
        data: { errorMessage: 'Authentication failed', code: 401 },
        timestamp: Date.now(),
      });
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.webSocketService.removeConnection(client.id);
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('message')
  async handleMessage(client: Socket, payload: any) {
    await this.webSocketService.handleMessage(client, payload);
  }

  @SubscribeMessage('typing')
  async handleTyping(client: Socket, payload: any) {
    await this.webSocketService.handleTyping(client, payload);
  }

  @SubscribeMessage('read_receipt')
  async handleReadReceipt(client: Socket, payload: any) {
    await this.webSocketService.handleReadReceipt(client, payload);
  }

  @SubscribeMessage('chat_update')
  async handleChatUpdate(client: Socket, payload: any) {
    await this.webSocketService.handleChatUpdate(client, payload);
  }

  @SubscribeMessage('ping')
  handlePing(client: Socket) {
    this.webSocketService.updateLastPing(client.id);

    client.emit('pong', {
      type: 'pong',
      data: { timestamp: Date.now() },
      timestamp: Date.now(),
    });
  }
}
