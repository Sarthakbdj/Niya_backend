import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiPersonasService } from '../ai-personas/ai-personas.service';
import { PersonaType } from '../ai-personas/interfaces';

export interface CreateChatDto {
  agentId: string;
}

export interface SendMessageDto {
  content: string;
  agentId: string;
}

export interface UpdateChatDto {
  title: string;
}

export interface MarkMessagesReadDto {
  messageIds: string[];
}

export interface PaginatedMessagesResponse {
  messages: any[];
  hasMore: boolean;
  total: number;
}

export interface MultiMessageResponse {
  messages: string[];
  isMultiMessage: boolean;
  firstMessage: string;
  totalMessages: number;
}

export interface SendMessageResponse {
  id: string;
  chatId: string;
  userId: number;
  agentId: string;
  content: string;
  role: string;
  timestamp: Date;
  metadata: any;
  isMultiMessage?: boolean;
  additionalMessages?: string[];
}

export interface BridgeMultiMessageResponse {
  messages: string[];
  is_multi_message: boolean;
  response: string;
  success: boolean;
}

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiPersonasService: AiPersonasService,
  ) {}

  async getAllChats(userId: number) {
    const chats = await this.prisma.chat.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: {
          select: { messages: true },
        },
      },
    });

    return chats.map((chat) => ({
      id: chat.id,
      userId: chat.userId,
      agentId: chat.agentId,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      messageCount: chat._count.messages,
      lastMessage: chat.lastMessage,
    }));
  }

  async getChat(chatId: string, userId: number) {
    const chat = await this.prisma.chat.findFirst({
      where: { id: chatId, userId },
      include: {
        messages: {
          orderBy: { timestamp: 'asc' },
        },
      },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    return {
      chatId: chat.id,
      messages: chat.messages.map((msg) => ({
        id: msg.id,
        chatId: msg.chatId,
        userId: msg.userId,
        agentId: msg.agentId,
        content: msg.content,
        role: msg.role,
        timestamp: msg.timestamp,
        metadata: msg.metadata,
      })),
      isLoading: false,
      hasNewMessages: false,
      pollCount: 0,
    };
  }

  async createChat(userId: number, createChatDto: CreateChatDto) {
    const { agentId } = createChatDto;

    // Validate agent ID
    const validAgentIds = ['therapist', 'dietician', 'career', 'priya'];
    if (!validAgentIds.includes(agentId)) {
      throw new BadRequestException('Invalid agent ID');
    }

    const chat = await this.prisma.chat.create({
      data: {
        userId,
        agentId,
        title: `New ${agentId} chat`,
        messageCount: 0,
      },
    });

    return {
      id: chat.id,
      userId: chat.userId,
      agentId: chat.agentId,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      messageCount: chat.messageCount,
    };
  }

  async sendMessage(
    chatId: string,
    userId: number,
    sendMessageDto: SendMessageDto,
  ): Promise<SendMessageResponse> {
    const { content, agentId } = sendMessageDto;

    // Verify chat exists and belongs to user
    const chat = await this.prisma.chat.findFirst({
      where: { id: chatId, userId },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    // Save user message
    await this.prisma.message.create({
      data: {
        chatId,
        userId,
        agentId,
        content,
        role: 'user',
        metadata: {
          messageIndex: chat.messageCount + 1,
          totalMessages: chat.messageCount + 1,
          read: false,
        },
      },
    });

    // Update chat
    await this.prisma.chat.update({
      where: { id: chatId },
      data: {
        messageCount: { increment: 1 },
        lastMessage: content,
        updatedAt: new Date(),
      },
    });

    // Generate AI response (now supports multi-message)
    const aiResponse = await this.generateAIResponse(
      chatId,
      userId,
      agentId,
      content,
    );

    return aiResponse;
  }

  async getMessages(
    chatId: string,
    userId: number,
    page: number = 1,
    limit: number = 50,
  ): Promise<PaginatedMessagesResponse> {
    const chat = await this.prisma.chat.findFirst({
      where: { id: chatId, userId },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    const skip = (page - 1) * limit;

    const [messages, total] = await Promise.all([
      this.prisma.message.findMany({
        where: { chatId },
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.message.count({
        where: { chatId },
      }),
    ]);

    return {
      messages: messages.reverse().map((msg) => ({
        id: msg.id,
        chatId: msg.chatId,
        userId: msg.userId,
        agentId: msg.agentId,
        content: msg.content,
        role: msg.role,
        timestamp: msg.timestamp,
        metadata: msg.metadata,
      })),
      hasMore: skip + limit < total,
      total,
    };
  }

  async pollNewMessages(
    chatId: string,
    userId: number,
    lastMessageId?: string,
  ) {
    const chat = await this.prisma.chat.findFirst({
      where: { id: chatId, userId },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    const whereClause: any = { chatId };
    if (lastMessageId) {
      const lastMessage = await this.prisma.message.findUnique({
        where: { id: lastMessageId },
      });
      if (lastMessage) {
        whereClause.timestamp = { gt: lastMessage.timestamp };
      }
    }

    const messages = await this.prisma.message.findMany({
      where: whereClause,
      orderBy: { timestamp: 'asc' },
    });

    return messages.map((msg) => ({
      id: msg.id,
      chatId: msg.chatId,
      userId: msg.userId,
      agentId: msg.agentId,
      content: msg.content,
      role: msg.role,
      timestamp: msg.timestamp,
      metadata: msg.metadata,
    }));
  }

  async updateChatTitle(
    chatId: string,
    userId: number,
    updateChatDto: UpdateChatDto,
  ) {
    const { title } = updateChatDto;

    const chat = await this.prisma.chat.findFirst({
      where: { id: chatId, userId },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    await this.prisma.chat.update({
      where: { id: chatId },
      data: { title },
    });

    return { success: true };
  }

  async deleteChat(chatId: string, userId: number) {
    const chat = await this.prisma.chat.findFirst({
      where: { id: chatId, userId },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    await this.prisma.chat.delete({
      where: { id: chatId },
    });

    return { success: true };
  }

  async markMessagesAsRead(
    chatId: string,
    userId: number,
    markMessagesReadDto: MarkMessagesReadDto,
  ) {
    const { messageIds } = markMessagesReadDto;

    const chat = await this.prisma.chat.findFirst({
      where: { id: chatId, userId },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    // Update messages to mark as read
    await Promise.all(
      messageIds.map((messageId) =>
        this.prisma.message.updateMany({
          where: { id: messageId, chatId },
          data: {
            metadata: {
              read: true,
            },
          },
        }),
      ),
    );

    return { success: true };
  }

  async generateAIResponse(
    chatId: string,
    userId: number,
    agentId: string,
    userMessage: string,
  ): Promise<SendMessageResponse> {
    try {
      console.log(`=== AI RESPONSE GENERATION DEBUG ===`);
      console.log(`AgentId: ${agentId}`);
      console.log(`User message: ${userMessage}`);

      // Map agentId to persona type
      const agentToPersonaMap: Record<string, PersonaType> = {
        therapist: 'THERAPIST',
        dietician: 'DIETICIAN',
        career: 'CAREER',
        priya: 'PRIYA',
      };

      const personaType = agentToPersonaMap[agentId];
      console.log(`Mapped persona type: ${personaType}`);

      if (!personaType) {
        console.log(`Invalid agent ID: ${agentId}`);
        throw new BadRequestException('Invalid agent ID');
      }

      // Get conversation history for context
      const conversationHistory = await this.prisma.message.findMany({
        where: { chatId },
        orderBy: { timestamp: 'asc' },
        take: 20, // Increased from 10 to 20 for better context
      });

      console.log(
        `Found ${conversationHistory.length} messages in conversation history`,
      );

      // Log recent conversation for debugging
      if (conversationHistory.length > 0) {
        console.log('Recent conversation:');
        conversationHistory.slice(-5).forEach((msg, idx) => {
          console.log(
            `  ${idx + 1}. [${msg.role}]: ${msg.content.substring(0, 100)}...`,
          );
        });
      }

      // Build conversation context - only include relevant messages
      const messages = conversationHistory
        .filter((msg) => msg.content && msg.content.trim().length > 0) // Filter out empty messages
        .map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

      // Add current user message
      messages.push({ role: 'user', content: userMessage });

      // Get system prompt for the persona
      const systemPromptForPersona =
        this.aiPersonasService.getSystemPrompt(personaType);

      console.log(
        `Retrieved system prompt for ${personaType}: ${systemPromptForPersona.substring(0, 100)}...`,
      );

      // Generate AI response (now supports multi-message)
      const aiResponseData = await this.generateMockAIResponse(
        systemPromptForPersona,
        messages,
      );

      // Handle both single and multi-message responses
      let primaryResponse: string;
      let additionalMessages: string[] = [];
      let isMultiMessage = false;

      console.log('🔍 AI RESPONSE DATA DEBUG:');
      console.log('- Type:', typeof aiResponseData);
      console.log(
        '- Has messages property:',
        typeof aiResponseData === 'object' && 'messages' in aiResponseData,
      );
      console.log('- Raw data:', JSON.stringify(aiResponseData, null, 2));

      if (typeof aiResponseData === 'object' && 'messages' in aiResponseData) {
        // Multi-message response from bridge
        const bridgeResponse = aiResponseData as BridgeMultiMessageResponse;
        primaryResponse = bridgeResponse.messages[0] || 'Hello!';
        additionalMessages = bridgeResponse.messages.slice(1);
        isMultiMessage = bridgeResponse.messages.length > 1;
        console.log(`✅ Multi-message response detected:`);
        console.log(`   - Total messages: ${bridgeResponse.messages.length}`);
        console.log(`   - Primary: "${primaryResponse.substring(0, 100)}..."`);
        console.log(`   - Additional: ${additionalMessages.length} messages`);
        additionalMessages.forEach((msg, index) => {
          console.log(
            `   - Additional ${index + 1}: "${msg.substring(0, 100)}..."`,
          );
        });
      } else if (typeof aiResponseData === 'string') {
        // Single message response
        primaryResponse = aiResponseData;
        console.log(
          `✅ Single message response: ${primaryResponse.substring(0, 100)}...`,
        );
      } else {
        console.error('❌ Invalid AI response format:', aiResponseData);
        throw new Error('Invalid AI response format');
      }

      // Save primary AI response
      const savedResponse = await this.prisma.message.create({
        data: {
          chatId,
          userId, // Using same userId for AI responses
          agentId,
          content: primaryResponse,
          role: 'assistant',
          metadata: {
            confidence: 0.9,
            messageIndex: conversationHistory.length + 2,
            totalMessages: conversationHistory.length + 2,
            read: false,
            isMultiMessage,
            additionalMessages: isMultiMessage ? additionalMessages : undefined,
          },
        },
      });

      // Update chat with primary message
      await this.prisma.chat.update({
        where: { id: chatId },
        data: {
          messageCount: { increment: 1 },
          lastMessage: primaryResponse,
          updatedAt: new Date(),
        },
      });

      console.log(
        `✅ AI response saved successfully with ID: ${savedResponse.id}`,
      );

      const finalResponse = {
        id: savedResponse.id,
        chatId: savedResponse.chatId,
        userId: savedResponse.userId,
        agentId: savedResponse.agentId,
        content: savedResponse.content,
        role: savedResponse.role,
        timestamp: savedResponse.timestamp,
        metadata: savedResponse.metadata,
        isMultiMessage,
        additionalMessages,
      };

      console.log('🔍 FINAL RESPONSE DEBUG:');
      console.log(`   - isMultiMessage: ${finalResponse.isMultiMessage}`);
      console.log(
        `   - additionalMessages count: ${finalResponse.additionalMessages?.length || 0}`,
      );
      console.log(
        `   - primary content: "${finalResponse.content.substring(0, 100)}..."`,
      );
      if (
        finalResponse.additionalMessages &&
        finalResponse.additionalMessages.length > 0
      ) {
        finalResponse.additionalMessages.forEach((msg, index) => {
          console.log(
            `   - additional ${index + 1}: "${msg.substring(0, 100)}..."`,
          );
        });
      }

      return finalResponse;
    } catch (error) {
      console.error('❌ Error in generateAIResponse:', error);
      if (error instanceof Error) {
        console.error('Error details:', error.message);
        console.error('Error stack:', error.stack);
      }
      throw error; // Re-throw to let the calling function handle it
    }
  }

  private async generateMockAIResponse(
    systemPrompt: string,
    messages: { role: string; content: string }[],
  ): Promise<string | BridgeMultiMessageResponse> {
    try {
      const lastMessage = (messages[messages.length - 1] as { content: string })
        .content;

      console.log('🚀 Calling Letta AI service...');
      console.log(
        `🔗 Python service URL: ${process.env.PYTHON_SERVICE_URL || 'http://localhost:1511'}`,
      );

      // Limit conversation context to last 6 messages to prevent overload
      const maxContextMessages = 6;
      const limitedMessages = messages.slice(-maxContextMessages);
      console.log(
        `📝 Sending conversation context: ${limitedMessages.length} messages (limited from ${messages.length})`,
      );
      console.log(`📝 Current message: "${lastMessage.substring(0, 100)}..."`);

      // Try with retry logic
      let lastError: Error | null = null;
      const maxRetries = 2;
      const baseTimeout = 25000; // 25 second timeout
      let response: Response | null = null;
      const startTime = Date.now();

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(
            `📡 Attempt ${attempt}/${maxRetries} - Timeout: ${baseTimeout}ms`,
          );

          response = await fetch(
            process.env.PYTHON_SERVICE_URL + '/message' ||
              'http://localhost:1511/message',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                message: lastMessage,
                conversation_history: limitedMessages, // Send limited conversation context
                system_prompt: systemPrompt, // Send system prompt for context
              }),
              signal: AbortSignal.timeout(baseTimeout), // 25 second timeout
            },
          );

          // Success, break out of retry loop
          break;
        } catch (error) {
          lastError = error as Error;
          console.error(
            `❌ Attempt ${attempt} failed:`,
            error instanceof Error ? error.message : error,
          );

          if (attempt === maxRetries) {
            // Final attempt failed, throw the error
            throw lastError;
          }

          // Wait 2 seconds before retry
          console.log(`⏳ Retrying in 2 seconds...`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      if (!response) {
        throw lastError || new Error('Failed to get response after retries');
      }

      if (!response.ok) {
        console.error(
          `❌ HTTP error! status: ${response.status}, statusText: ${response.statusText}`,
        );
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      console.log(`📥 Received response from Letta, parsing JSON...`);
      const data:
        | BridgeMultiMessageResponse
        | { success: boolean; response: string; error: string | null } =
        await response.json();
      console.log(`📋 Parsed data:`, JSON.stringify(data, null, 2));

      if (data.success) {
        const endTime = Date.now();
        const duration = endTime - startTime;

        // Enhanced debugging for multi-message detection
        console.log('🔍 MULTI-MESSAGE DEBUG:');
        console.log('- Has "messages" property:', 'messages' in data);
        console.log('- Messages array:', (data as any).messages);
        console.log('- Messages length:', (data as any).messages?.length);
        console.log(
          '- Has "is_multi_message":',
          (data as any).is_multi_message,
        );
        console.log('- Data keys:', Object.keys(data));

        // Check if it's a multi-message response
        if ('messages' in data && data.messages && data.messages.length > 0) {
          console.log(
            `✅ Letta responded in ${duration}ms with ${data.messages.length} messages:`,
          );
          data.messages.forEach((msg, index) => {
            console.log(`   ${index + 1}. "${msg.substring(0, 100)}..."`);
          });
          return data as BridgeMultiMessageResponse;
        } else if ('response' in data && data.response) {
          console.log(
            `✅ Letta responded in ${duration}ms with single message: ${data.response.substring(0, 100)}...`,
          );
          return data.response;
        } else {
          console.error('❌ No valid response found in data:', data);
          throw new Error('No valid response from AI service');
        }
      } else {
        throw new Error((data as any).error || 'No response from AI service');
      }
    } catch (error) {
      console.error('🚨 LETTA AI SERVICE FAILED - NO FALLBACK USED!');
      console.error('❌ Error calling AI service:', error);
      console.error('Detailed error information:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        name: error instanceof Error ? error.name : 'Unknown',
        stack: error instanceof Error ? error.stack : 'No stack trace',
        url:
          process.env.PYTHON_SERVICE_URL + '/message' ||
          'http://localhost:1511/message',
        timestamp: new Date().toISOString(),
      });

      // NO FALLBACK - Only use Letta AI. If it fails, the whole request fails.
      throw new Error(
        `Letta AI service unavailable: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
