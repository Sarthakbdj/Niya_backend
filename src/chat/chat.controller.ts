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
} from '@nestjs/common';
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

      return {
        success: true,
        data: response,
      };
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
}
