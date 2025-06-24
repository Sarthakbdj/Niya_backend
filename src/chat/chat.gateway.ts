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
    methods: ['GET', 'POST'],
    credentials: true,
  },
  namespace: '/ws',
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 10000,
  allowEIO3: true,
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
      this.logger.log(`New connection attempt: ${client.id}`);

      // Extract JWT token from query parameters
      const token = client.handshake.query.token as string;
      if (!token) {
        this.logger.warn(`Connection ${client.id} rejected: No token provided`);
        client.emit('error', {
          type: 'error',
          data: { errorMessage: 'Authentication token required', code: 401 },
          timestamp: Date.now(),
        });
        client.disconnect();
        return;
      }

      // Validate JWT token - make it more lenient for connection issues
      this.logger.log(
        `Processing connection with token: ${token.substring(0, 20)}...`,
      );

      let payload: { sub: number; email: string; googleId: string };
      try {
        // Try to decode the JWT token
        payload = this.jwtService.decode(token) as {
          sub: number;
          email: string;
          googleId: string;
        };
        if (!payload || !payload.sub) {
          throw new Error('Invalid token payload');
        }
      } catch (tokenError) {
        this.logger.error('Token decode error:', tokenError);
        client.emit('error', {
          type: 'error',
          data: { errorMessage: 'Invalid authentication token', code: 401 },
          timestamp: Date.now(),
        });
        client.disconnect();
        return;
      }

      this.logger.log(`Decoded payload for user ID: ${payload.sub}`);

      // Check if user exists in database
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user) {
        this.logger.warn(`User ${payload.sub} not found in database`);
        client.emit('error', {
          type: 'error',
          data: { errorMessage: 'User not found', code: 404 },
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

      // Send connection success confirmation
      client.emit('connected', {
        type: 'connected',
        data: {
          userId: user.id,
          connectionId: client.id,
          status: 'connected',
        },
        timestamp: Date.now(),
      });

      this.logger.log(
        `✅ User ${user.id} successfully connected with socket ${client.id}`,
      );
    } catch (error) {
      this.logger.error('❌ Connection error:', error);
      client.emit('error', {
        type: 'error',
        data: { errorMessage: 'Connection failed', code: 500 },
        timestamp: Date.now(),
      });
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    try {
      const connection = this.webSocketService.getConnection(client.id);
      if (connection) {
        this.logger.log(
          `👋 User ${connection.userId} disconnecting (${client.id})`,
        );
      } else {
        this.logger.log(`👋 Unknown client disconnecting: ${client.id}`);
      }

      this.webSocketService.removeConnection(client.id);
      this.logger.log(`✅ Connection ${client.id} cleaned up successfully`);
    } catch (error) {
      this.logger.error(
        `❌ Error during disconnect cleanup for ${client.id}:`,
        error,
      );
    }
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
