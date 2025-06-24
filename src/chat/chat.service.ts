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
  ) {
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

    // Generate AI response
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
  ) {
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

    // TODO: Integrate with actual AI service (OpenAI, etc.)
    // For now, return a mock response
    const aiResponse = await this.generateMockAIResponse(
      systemPromptForPersona,
      messages,
    );

    console.log(`Generated AI response: ${aiResponse.substring(0, 100)}...`);

    // Save AI response
    const savedResponse = await this.prisma.message.create({
      data: {
        chatId,
        userId, // Using same userId for AI responses
        agentId,
        content: aiResponse,
        role: 'assistant',
        metadata: {
          confidence: 0.9,
          messageIndex: conversationHistory.length + 2,
          totalMessages: conversationHistory.length + 2,
          read: false,
        },
      },
    });

    // Update chat
    await this.prisma.chat.update({
      where: { id: chatId },
      data: {
        messageCount: { increment: 1 },
        lastMessage: aiResponse,
        updatedAt: new Date(),
      },
    });

    return {
      id: savedResponse.id,
      chatId: savedResponse.chatId,
      userId: savedResponse.userId,
      agentId: savedResponse.agentId,
      content: savedResponse.content,
      role: savedResponse.role,
      timestamp: savedResponse.timestamp,
      metadata: savedResponse.metadata,
    };
  }

  private async generateMockAIResponse(
    systemPrompt: string,
    messages: { role: string; content: string }[],
  ): Promise<string> {
    console.log('=== AI SERVICE INTEGRATION ===');
    console.log('Attempting to generate AI response...');

    try {
      // Use OpenAI API directly instead of localhost:1511
      const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

      if (!OPENAI_API_KEY) {
        console.log(
          'No OpenAI API key found, falling back to persona responses',
        );
        throw new Error('OpenAI API key not configured');
      }

      // Build messages for OpenAI API
      const openAIMessages = [
        { role: 'system', content: systemPrompt },
        ...messages,
      ];

      console.log('Calling OpenAI API with messages:', openAIMessages.length);

      const response = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
            messages: openAIMessages,
            max_tokens: 500,
            temperature: 0.7,
            stream: false,
          }),
          signal: AbortSignal.timeout(10000), // 10 second timeout
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('OpenAI API error:', response.status, errorText);
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json();

      if (
        data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content
      ) {
        const aiResponse = data.choices[0].message.content.trim();
        console.log(
          '✅ OpenAI API response received:',
          aiResponse.substring(0, 100) + '...',
        );
        return aiResponse;
      } else {
        console.error('Invalid OpenAI API response format:', data);
        throw new Error('Invalid response format from OpenAI');
      }
    } catch (error) {
      console.error('Error calling OpenAI API:', (error as Error).message);
      console.log(
        'Falling back to enhanced persona-based response generation...',
      );

      // Enhanced fallback with better context awareness
      return this.generatePersonaBasedResponse(systemPrompt, messages);
    }
  }

  private generatePersonaBasedResponse(
    systemPrompt: string,
    messages: { role: string; content: string }[],
  ): string {
    const lastMessage = messages[messages.length - 1].content.toLowerCase();
    const conversationHistory = messages.slice(-5); // Get last 5 messages for context

    console.log(`=== PERSONA DEBUG ===`);
    console.log(`Full system prompt: ${systemPrompt}`);
    console.log(`User message: ${lastMessage}`);
    console.log(`Conversation history length: ${conversationHistory.length}`);

    // Make sure we're checking the correct persona patterns
    const promptLower = systemPrompt.toLowerCase();

    // Check if this is the first message in conversation
    const isFirstMessage =
      messages.filter((m) => m.role === 'user').length <= 1;

    // Check for recent AI responses to avoid repetition
    const recentAIResponses = conversationHistory
      .filter((m) => m.role === 'assistant')
      .map((m) => m.content.toLowerCase());

    // Priya (girlfriend personality) responses - Check this FIRST
    if (
      promptLower.includes('girlfriend') ||
      promptLower.includes('priya') ||
      promptLower.includes('caring') ||
      promptLower.includes('loving')
    ) {
      console.log('Detected PRIYA persona');

      if (
        isFirstMessage ||
        lastMessage.includes('hello') ||
        lastMessage.includes('hi') ||
        lastMessage.includes('hey')
      ) {
        const greetings = [
          "Hey there! 😊 I've been thinking about you. How has your day been so far?",
          "Hi sweetie! 💕 You know you always make my day brighter when you message me. What's going on?",
          "Hey babe! I was just wondering how you're doing. Tell me everything! 🥰",
        ];
        return greetings[Math.floor(Math.random() * greetings.length)];
      }

      if (lastMessage.includes('love') || lastMessage.includes('miss')) {
        const loveResponses = [
          "Aww, you're so sweet! I care about you so much too. You always know how to make me smile. 💕",
          "You're making me blush! I feel the same way about you, honey. You mean everything to me. ❤️",
          'I love you too, darling! You have such a beautiful heart. 💖',
        ];
        return loveResponses[Math.floor(Math.random() * loveResponses.length)];
      }

      if (lastMessage.includes('tired') || lastMessage.includes('stressed')) {
        return "Oh honey, you sound like you've had a tough day. Come here, let me make you feel better. Want to talk about what's been bothering you? I'm all ears. ❤️";
      }

      if (lastMessage.includes('work') || lastMessage.includes('busy')) {
        return "I know you work so hard, and I'm really proud of you! But don't forget to take care of yourself too, okay? You mean the world to me. 🥰";
      }

      // More varied responses based on conversation flow
      const generalResponses = [
        "I love hearing from you! You always brighten my day. What's on your mind, sweetheart? 💖",
        "Tell me more about that, baby. I'm really interested in what you think. 😊",
        "You're so thoughtful! I love how you see things. What else is on your mind? 💕",
        "That's really interesting! I love learning about what matters to you. 🥰",
      ];

      // Avoid recently used responses
      const availableResponses = generalResponses.filter(
        (response) =>
          !recentAIResponses.some((recent) =>
            recent.includes(response.toLowerCase().substring(0, 20)),
          ),
      );

      return availableResponses.length > 0
        ? availableResponses[
            Math.floor(Math.random() * availableResponses.length)
          ]
        : generalResponses[Math.floor(Math.random() * generalResponses.length)];
    }

    // Therapist responses
    if (
      promptLower.includes('therapist') ||
      promptLower.includes('empathetic') ||
      promptLower.includes('mental health')
    ) {
      console.log('Detected THERAPIST persona');

      if (
        lastMessage.includes('anxious') ||
        lastMessage.includes('stress') ||
        lastMessage.includes('worried')
      ) {
        const anxietyResponses = [
          "I understand you're feeling anxious. Let's explore this together. Can you tell me more about what's causing this anxiety? Remember, it's completely normal to feel this way, and I'm here to support you.",
          "Anxiety can feel overwhelming, but you're not alone in this. What specific thoughts or situations are triggering these feelings for you?",
          "I hear that you're experiencing anxiety. That takes courage to share. What would help you feel more supported right now?",
        ];
        return anxietyResponses[
          Math.floor(Math.random() * anxietyResponses.length)
        ];
      }

      if (
        lastMessage.includes('sad') ||
        lastMessage.includes('depressed') ||
        lastMessage.includes('down')
      ) {
        const sadnessResponses = [
          "I hear that you're going through a difficult time. Your feelings are valid, and it's okay to feel sad. Would you like to talk about what's been weighing on your mind?",
          "Thank you for trusting me with these difficult feelings. Sadness is a natural response to life's challenges. What's been the hardest part for you lately?",
          "It sounds like you're carrying some heavy emotions. I'm here to listen without judgment. What would be most helpful to explore right now?",
        ];
        return sadnessResponses[
          Math.floor(Math.random() * sadnessResponses.length)
        ];
      }

      if (
        lastMessage.includes('happy') ||
        lastMessage.includes('good') ||
        lastMessage.includes('excited')
      ) {
        const happyResponses = [
          "I'm so glad to hear you're feeling positive! It's wonderful when we can recognize and appreciate the good moments. What's been bringing you joy lately?",
          "That's wonderful to hear! Positive emotions are just as important to explore. What's contributing to these good feelings?",
          "I love hearing the happiness in your words. What's been going particularly well for you?",
        ];
        return happyResponses[
          Math.floor(Math.random() * happyResponses.length)
        ];
      }

      // If this is a follow-up in conversation, be more specific
      if (!isFirstMessage) {
        const followUpResponses = [
          "I'm listening. Can you tell me more about how that makes you feel?",
          'That sounds significant. What thoughts come up for you when you think about that?',
          'I appreciate you sharing that with me. What would you like to explore about this further?',
          'How has that been affecting you day to day?',
          'What support do you feel you need around this situation?',
        ];

        const availableResponses = followUpResponses.filter(
          (response) =>
            !recentAIResponses.some((recent) =>
              recent.includes(response.toLowerCase().substring(0, 15)),
            ),
        );

        if (availableResponses.length > 0) {
          return availableResponses[
            Math.floor(Math.random() * availableResponses.length)
          ];
        }
      }

      // Default therapist responses - more varied
      const defaultResponses = [
        "Thank you for sharing that with me. I'm here to listen and support you. What would you like to explore together today?",
        "I'm glad you're here. What's been on your mind lately that you'd like to talk about?",
        'Thank you for trusting me with your thoughts. What feels most important to discuss right now?',
        "I'm here to support you through whatever you're experiencing. What would be most helpful to focus on today?",
      ];

      const availableDefaults = defaultResponses.filter(
        (response) =>
          !recentAIResponses.some((recent) =>
            recent.includes(response.toLowerCase().substring(0, 20)),
          ),
      );

      return availableDefaults.length > 0
        ? availableDefaults[
            Math.floor(Math.random() * availableDefaults.length)
          ]
        : defaultResponses[Math.floor(Math.random() * defaultResponses.length)];
    }

    // Dietician responses
    if (
      promptLower.includes('dietician') ||
      promptLower.includes('nutrition') ||
      promptLower.includes('fitness')
    ) {
      console.log('Detected DIETICIAN persona');

      if (
        lastMessage.includes('diet') ||
        lastMessage.includes('nutrition') ||
        lastMessage.includes('eat')
      ) {
        return "I'd be happy to help you with your nutrition goals! To provide the best advice, could you tell me about your current eating habits, any dietary restrictions, and what you're hoping to achieve?";
      }

      if (
        lastMessage.includes('weight') ||
        lastMessage.includes('lose') ||
        lastMessage.includes('gain')
      ) {
        return "Weight management is a journey that's different for everyone. Let's focus on creating sustainable, healthy habits. What are your current goals, and what does your typical day of eating look like?";
      }

      if (
        lastMessage.includes('exercise') ||
        lastMessage.includes('workout') ||
        lastMessage.includes('fitness')
      ) {
        return "Great question about fitness! Exercise and nutrition work hand in hand. What's your current activity level, and what type of physical activities do you enjoy or would like to try?";
      }

      const generalDietResponses = [
        "I'm here to help you with all things related to nutrition and wellness. What specific aspect of your health journey would you like to discuss today?",
        "What brings you here today? I'd love to help you with your nutrition and fitness goals!",
        'Tell me about your current health goals. How can I support you in achieving them?',
      ];

      return generalDietResponses[
        Math.floor(Math.random() * generalDietResponses.length)
      ];
    }

    // Career counselor responses
    if (promptLower.includes('career') || promptLower.includes('counselor')) {
      console.log('Detected CAREER persona');

      if (
        lastMessage.includes('career') ||
        lastMessage.includes('job') ||
        lastMessage.includes('work')
      ) {
        return "I'm here to help you with your career journey! What specific aspect would you like to discuss? Whether it's skill development, job searching, or career planning, I'm ready to assist.";
      }

      if (lastMessage.includes('interview') || lastMessage.includes('resume')) {
        return 'Job applications can be challenging, but with the right preparation, you can stand out! Are you looking for help with resume writing, interview preparation, or both?';
      }

      if (
        lastMessage.includes('skill') ||
        lastMessage.includes('learn') ||
        lastMessage.includes('course')
      ) {
        return "Continuous learning is key to career growth! What skills are you interested in developing, and what's driving this interest? I can help you create a learning plan.";
      }

      const careerResponses = [
        "I'm here to support your professional development and career goals. What career-related challenge or opportunity would you like to explore today?",
        "Let's work on advancing your career together! What aspect of your professional life would you like to focus on?",
        "What's your biggest career question or challenge right now? I'm here to help you navigate it.",
      ];

      return careerResponses[
        Math.floor(Math.random() * careerResponses.length)
      ];
    }

    console.log('No persona detected, using default fallback');
    // Default fallback - more varied
    const fallbackResponses = [
      "I'm here and ready to help you with whatever you'd like to discuss. What's on your mind today?",
      "Hello! I'm glad you reached out. What would you like to talk about?",
      'Hi there! How can I support you today?',
      "I'm listening. What's been on your mind lately?",
    ];

    return fallbackResponses[
      Math.floor(Math.random() * fallbackResponses.length)
    ];
  }
}
