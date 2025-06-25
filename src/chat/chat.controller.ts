import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Request,
  UseGuards,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ChatService,
  CreateChatDto,
  SendMessageDto,
  UpdateChatDto,
  MarkMessagesReadDto,
} from './chat.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WebSocketService } from './websocket.service';

@Controller('chats')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly webSocketService: WebSocketService,
  ) {}

  @Get()
  async getAllChats(@Request() req: any) {
    const userId = req.user.id;
    const chats = await this.chatService.getAllChats(userId);
    return {
      success: true,
      data: chats,
    };
  }

  @Get(':chatId')
  async getChat(@Param('chatId') chatId: string, @Request() req: any) {
    const userId = req.user.id;
    const chat = await this.chatService.getChat(chatId, userId);
    return {
      success: true,
      data: chat,
    };
  }

  @Post()
  async createChat(@Body() createChatDto: CreateChatDto, @Request() req: any) {
    const userId = req.user.id;
    const chat = await this.chatService.createChat(userId, createChatDto);
    return {
      success: true,
      data: chat,
    };
  }

  @Post(':chatId/messages')
  async sendMessage(
    @Param('chatId') chatId: string,
    @Body() sendMessageDto: SendMessageDto,
    @Request() req: any,
  ) {
    try {
      console.log('=== SEND MESSAGE DEBUG ===');
      console.log('Chat ID:', chatId);
      console.log('User ID:', req.user?.id);
      console.log('Message DTO:', sendMessageDto);

      const userId = req.user.id;

      if (!userId) {
        throw new Error('User ID not found in request');
      }

      if (!chatId) {
        throw new Error('Chat ID is required');
      }

      if (
        !sendMessageDto ||
        !sendMessageDto.content ||
        !sendMessageDto.agentId
      ) {
        throw new Error(
          'Invalid message data: content and agentId are required',
        );
      }

      const response = await this.chatService.sendMessage(
        chatId,
        userId,
        sendMessageDto,
      );

      console.log('Message sent successfully, response:', response.id);

      console.log('🔍 CONTROLLER RESPONSE DEBUG:');
      console.log(`   - Response isMultiMessage: ${response.isMultiMessage}`);
      console.log(
        `   - Response additionalMessages: ${response.additionalMessages?.length || 0}`,
      );

      // Return both single and multi-message format for backward compatibility
      if (response.isMultiMessage && response.additionalMessages) {
        const controllerResponse = {
          success: true,
          data: response,
          // Add multi-message info for frontends that can handle it
          messages: [response.content, ...response.additionalMessages],
          isMultiMessage: true,
          totalMessages: response.additionalMessages.length + 1,
        };

        console.log('🔍 SENDING MULTI-MESSAGE RESPONSE TO FRONTEND:');
        console.log(`   - success: ${controllerResponse.success}`);
        console.log(
          `   - isMultiMessage: ${controllerResponse.isMultiMessage}`,
        );
        console.log(`   - totalMessages: ${controllerResponse.totalMessages}`);
        console.log(
          `   - messages array: ${controllerResponse.messages.length} items`,
        );
        controllerResponse.messages.forEach((msg, index) => {
          console.log(
            `   - message ${index + 1}: "${msg.substring(0, 100)}..."`,
          );
        });

        return controllerResponse;
      } else {
        console.log('🔍 SENDING SINGLE MESSAGE RESPONSE TO FRONTEND');
        return {
          success: true,
          data: response,
        };
      }
    } catch (error) {
      console.error('❌ Send message error:', error);
      if (error instanceof Error) {
        console.error('Error stack:', error.stack);
      }
      throw error; // Re-throw to let NestJS handle it properly
    }
  }

  @Get(':chatId/messages')
  async getMessages(
    @Param('chatId') chatId: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
    @Request() req: any,
  ) {
    const userId = req.user.id;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const response = await this.chatService.getMessages(
      chatId,
      userId,
      pageNum,
      limitNum,
    );
    return {
      success: true,
      data: response,
    };
  }

  @Get(':chatId/messages/poll')
  async pollNewMessages(
    @Param('chatId') chatId: string,
    @Query('lastMessageId') lastMessageId: string,
    @Request() req: any,
  ) {
    const userId = req.user.id;
    const messages = await this.chatService.pollNewMessages(
      chatId,
      userId,
      lastMessageId,
    );
    return {
      success: true,
      data: messages,
    };
  }

  @Patch(':chatId')
  async updateChatTitle(
    @Param('chatId') chatId: string,
    @Body() updateChatDto: UpdateChatDto,
    @Request() req: any,
  ) {
    const userId = req.user.id;
    const result = await this.chatService.updateChatTitle(
      chatId,
      userId,
      updateChatDto,
    );
    return result;
  }

  @Delete(':chatId')
  async deleteChat(@Param('chatId') chatId: string, @Request() req: any) {
    const userId = req.user.id;
    const result = await this.chatService.deleteChat(chatId, userId);
    return result;
  }

  @Post(':chatId/messages/read')
  async markMessagesAsRead(
    @Param('chatId') chatId: string,
    @Body() markMessagesReadDto: MarkMessagesReadDto,
    @Request() req: any,
  ) {
    const userId = req.user.id;
    const result = await this.chatService.markMessagesAsRead(
      chatId,
      userId,
      markMessagesReadDto,
    );
    return result;
  }

  @Get('ws/health')
  async getWebSocketHealth() {
    const stats = this.webSocketService.getConnectionStats();
    return {
      status: 'healthy',
      connections: stats.totalConnections,
      activeChats: stats.activeChats,
      uptime: process.uptime(),
    };
  }

  @Post('test-bridge')
  async testBridge(@Body() body: { message: string }) {
    try {
      console.log('🧪 TESTING BRIDGE CONNECTION');
      console.log('Test message:', body.message);

      const response = await fetch('http://localhost:1511/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message:
            body.message || 'Hello, test message for multi-message feature',
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      console.log('🧪 BRIDGE RESPONSE:');
      console.log('Raw response:', JSON.stringify(data, null, 2));

      return {
        success: true,
        bridgeResponse: data,
        isMultiMessage: data.messages && data.messages.length > 1,
        messageCount: data.messages ? data.messages.length : 1,
        testResults: {
          hasMessages: 'messages' in data,
          hasIsMultiMessage: 'is_multi_message' in data,
          hasResponse: 'response' in data,
          hasSuccess: 'success' in data,
        },
      };
    } catch (error) {
      console.error('❌ Bridge test error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        bridgeResponse: null,
      };
    }
  }

  @Post(':chatId/messages/stream')
  async streamMessages(
    @Param('chatId') chatId: string,
    @Body() sendMessageDto: SendMessageDto,
    @Request() req: any,
    @Res() res: Response,
  ) {
    try {
      console.log('=== STREAM MESSAGES DEBUG ===');
      console.log('Chat ID:', chatId);
      console.log('User ID:', req.user?.id);
      console.log('Message DTO:', sendMessageDto);

      const userId = req.user.id;

      if (!userId) {
        throw new Error('User ID not found in request');
      }

      if (!chatId) {
        throw new Error('Chat ID is required');
      }

      if (
        !sendMessageDto ||
        !sendMessageDto.content ||
        !sendMessageDto.agentId
      ) {
        throw new Error(
          'Invalid message data: content and agentId are required',
        );
      }

      // Set up Server-Sent Events
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control',
      });

      // Send initial connection confirmation
      res.write(
        `data: ${JSON.stringify({ type: 'connected', message: 'Stream connected' })}\n\n`,
      );

      const response = await this.chatService.sendMessage(
        chatId,
        userId,
        sendMessageDto,
      );

      console.log('Message sent successfully, streaming response');

      // If it's a multi-message response, stream each message with delay
      if (response.isMultiMessage && response.additionalMessages) {
        // Send first message immediately
        res.write(
          `data: ${JSON.stringify({
            type: 'message',
            data: {
              id: response.id,
              chatId: response.chatId,
              content: response.content,
              role: response.role,
              timestamp: response.timestamp,
              isFirst: true,
              totalMessages: response.additionalMessages.length + 1,
            },
          })}\n\n`,
        );

        // Send additional messages with realistic delays
        for (let i = 0; i < response.additionalMessages.length; i++) {
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 + Math.random() * 2000),
          ); // 1-3 second delay

          res.write(
            `data: ${JSON.stringify({
              type: 'message',
              data: {
                id: `${response.id}_${i + 1}`,
                chatId: response.chatId,
                content: response.additionalMessages[i],
                role: response.role,
                timestamp: new Date().toISOString(),
                isAdditional: true,
                messageIndex: i + 2,
                totalMessages: response.additionalMessages.length + 1,
              },
            })}\n\n`,
          );
        }
      } else {
        // Single message response
        res.write(
          `data: ${JSON.stringify({
            type: 'message',
            data: {
              id: response.id,
              chatId: response.chatId,
              content: response.content,
              role: response.role,
              timestamp: response.timestamp,
              isSingle: true,
            },
          })}\n\n`,
        );
      }

      // Send completion event
      res.write(
        `data: ${JSON.stringify({ type: 'complete', message: 'Stream complete' })}\n\n`,
      );
      res.end();
    } catch (error) {
      console.error('❌ Stream messages error:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      res.write(
        `data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`,
      );
      res.end();
    }
  }

  @Post(':chatId/messages/multi')
  async sendMultiMessage(
    @Param('chatId') chatId: string,
    @Body() sendMessageDto: SendMessageDto,
    @Request() req: any,
  ) {
    try {
      console.log('=== MULTI MESSAGE DEBUG ===');
      console.log('Chat ID:', chatId);
      console.log('User ID:', req.user?.id);
      console.log('Message DTO:', sendMessageDto);

      const userId = req.user.id;

      if (!userId) {
        throw new Error('User ID not found in request');
      }

      const response = await this.chatService.sendMessage(
        chatId,
        userId,
        sendMessageDto,
      );

      console.log('Multi-message sent successfully');

      // Return multi-message format for frontend
      if (response.isMultiMessage && response.additionalMessages) {
        return {
          success: true,
          data: {
            messages: [response.content, ...response.additionalMessages],
            isMultiMessage: true,
            primaryMessage: response,
            totalMessages: response.additionalMessages.length + 1,
          },
        };
      } else {
        return {
          success: true,
          data: {
            messages: [response.content],
            isMultiMessage: false,
            primaryMessage: response,
            totalMessages: 1,
          },
        };
      }
    } catch (error) {
      console.error('❌ Multi message error:', error);
      throw error;
    }
  }
}
