import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { ChatCompletionMessageParam } from '@fastgpt/global/core/ai/llm/type';
import { ChatCompletionRequestMessageRoleEnum } from '@fastgpt/global/core/ai/constants';
import type { LLMModelItemType } from '@fastgpt/global/core/ai/model.schema';
import { ModelTypeEnum } from '@fastgpt/global/core/ai/constants';

// Mock dependencies
vi.mock('@fastgpt/service/core/ai/config', () => ({
  getAIApi: vi.fn()
}));

vi.mock('@fastgpt/service/core/ai/model', () => ({
  getLLMModel: vi.fn()
}));

vi.mock('@fastgpt/service/core/ai/llm/utils', () => ({
  loadRequestMessages: vi.fn()
}));

vi.mock('@fastgpt/service/common/string/tiktoken/index', () => ({
  countGptMessagesTokens: vi.fn()
}));

vi.mock('@fastgpt/web/i18n/utils', () => ({
  i18nT: vi.fn((key: string) => key)
}));

vi.mock('@fastgpt/service/core/ai/llm/promptCall', () => ({
  parsePromptToolCall: vi.fn((content: string) => ({
    answer: content,
    streamAnswer: '',
    toolCalls: undefined
  })),
  promptToolCallMessageRewrite: vi.fn((messages: any) => messages)
}));

vi.mock('@fastgpt/global/core/ai/llm/utils', () => ({
  removeDatasetCiteText: vi.fn((text: string) => text),
  getLLMSupportParams: vi.fn(() => ({
    vision: false,
    temperature: true,
    reasoning: false,
    topP: true,
    stop: true,
    responseFormat: false,
    supportToolCall: true
  }))
}));

vi.mock('@fastgpt/service/core/ai/utils', () => ({
  computedMaxToken: vi.fn(({ maxToken }: { maxToken?: number }) => maxToken || 4096),
  computedTemperature: vi.fn(({ temperature }: { temperature: number }) => temperature),
  parseLLMStreamResponse: vi.fn(),
  parseReasoningContent: vi.fn((content: string) => ['', content])
}));

vi.mock('@fastgpt/service/core/ai/record/controller', () => ({
  saveLLMRequestRecord: vi.fn()
}));

// Import mocked modules
import { getAIApi } from '@fastgpt/service/core/ai/config';
import { getLLMModel } from '@fastgpt/service/core/ai/model';
import { loadRequestMessages } from '@fastgpt/service/core/ai/llm/utils';
import { countGptMessagesTokens } from '@fastgpt/service/common/string/tiktoken/index';

// Import the functions to test
import { createLLMResponse, parseExtraBody } from '@fastgpt/service/core/ai/llm/request';

const mockGetAIApi = vi.mocked(getAIApi);
const mockGetLLMModel = vi.mocked(getLLMModel);
const mockLoadRequestMessages = vi.mocked(loadRequestMessages);
const mockCountGptMessagesTokens = vi.mocked(countGptMessagesTokens);

const createMockModelData = (overrides?: Partial<LLMModelItemType>): LLMModelItemType => ({
  type: ModelTypeEnum.llm,
  provider: 'openai',
  model: 'gpt-4',
  name: 'GPT-4',
  maxContext: 128000,
  maxResponse: 4096,
  quoteMaxToken: 60000,
  functionCall: true,
  toolChoice: true,
  reasoning: false,
  ...overrides
});

const mockSuccessAI = () => {
  const mockCreate = vi.fn().mockResolvedValue({
    choices: [
      {
        message: { role: 'assistant', content: 'ok' },
        finish_reason: 'stop'
      }
    ],
    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 }
  });
  mockGetAIApi.mockReturnValue({
    chat: {
      completions: {
        create: mockCreate
      }
    }
  } as any);
  return mockCreate;
};

const messages: ChatCompletionMessageParam[] = [
  { role: ChatCompletionRequestMessageRoleEnum.User, content: 'Hello' }
];

describe('parseExtraBody', () => {
  it('should parse JSON string to object', () => {
    expect(parseExtraBody('{"reasoning_effort": "high"}')).toEqual({
      reasoning_effort: 'high'
    });
  });

  it('should parse json5 string to object', () => {
    expect(parseExtraBody("{ reasoning_effort: 'high', thinking: { type: 'enabled' } }")).toEqual({
      reasoning_effort: 'high',
      thinking: { type: 'enabled' }
    });
  });

  it('should return object directly', () => {
    const obj = { reasoning_effort: 'high' };
    expect(parseExtraBody(obj)).toBe(obj);
  });

  it('should return undefined for empty values', () => {
    expect(parseExtraBody(undefined)).toBeUndefined();
    expect(parseExtraBody('')).toBeUndefined();
    expect(parseExtraBody('   ')).toBeUndefined();
    expect(parseExtraBody({})).toBeUndefined();
    expect(parseExtraBody('{}')).toBeUndefined();
    expect(parseExtraBody('null')).toBeUndefined();
  });

  it('should throw "Extra body error" for invalid JSON string', () => {
    expect(() => parseExtraBody('{invalid json')).toThrow('Extra body error');
  });
});

describe('createLLMResponse extraBody', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetLLMModel.mockReturnValue(createMockModelData());
    mockLoadRequestMessages.mockImplementation(async ({ messages }: any) => messages as any);
    mockCountGptMessagesTokens.mockResolvedValue(100);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should merge string extraBody into request body', async () => {
    const mockCreate = mockSuccessAI();

    await createLLMResponse({
      body: {
        model: 'gpt-4',
        messages,
        stream: false,
        extraBody: '{"reasoning_effort": "high", "thinking": {"type": "enabled"}}'
      }
    });

    const requestBody = mockCreate.mock.calls[0][0];
    expect(requestBody.reasoning_effort).toBe('high');
    expect(requestBody.thinking).toEqual({ type: 'enabled' });
    expect(requestBody).not.toHaveProperty('extraBody');
  });

  it('should merge object extraBody into request body', async () => {
    const mockCreate = mockSuccessAI();

    await createLLMResponse({
      body: {
        model: 'gpt-4',
        messages,
        stream: false,
        extraBody: { reasoning_effort: 'low' }
      }
    });

    const requestBody = mockCreate.mock.calls[0][0];
    expect(requestBody.reasoning_effort).toBe('low');
    expect(requestBody).not.toHaveProperty('extraBody');
  });

  it('should override defaultConfig keys with extraBody and keep other defaultConfig keys', async () => {
    mockGetLLMModel.mockReturnValue(
      createMockModelData({
        defaultConfig: { reasoning_effort: 'low', custom_param: 1 } as any
      })
    );
    const mockCreate = mockSuccessAI();

    await createLLMResponse({
      body: {
        model: 'gpt-4',
        messages,
        stream: false,
        extraBody: '{"reasoning_effort": "high"}'
      }
    });

    const requestBody = mockCreate.mock.calls[0][0];
    expect(requestBody.reasoning_effort).toBe('high');
    expect(requestBody.custom_param).toBe(1);
  });

  it('should throw "Extra body error" for invalid JSON string', async () => {
    mockSuccessAI();

    await expect(
      createLLMResponse({
        body: {
          model: 'gpt-4',
          messages,
          stream: false,
          extraBody: '{invalid json'
        }
      })
    ).rejects.toThrow('Extra body error');
  });

  it('should not change request body when extraBody is not provided', async () => {
    mockGetLLMModel.mockReturnValue(
      createMockModelData({
        defaultConfig: { custom_param: 1 } as any
      })
    );
    const mockCreate = mockSuccessAI();

    await createLLMResponse({
      body: {
        model: 'gpt-4',
        messages,
        stream: false
      }
    });

    const requestBody = mockCreate.mock.calls[0][0];
    expect(requestBody.custom_param).toBe(1);
    expect(requestBody).not.toHaveProperty('extraBody');
  });

  it('should not change request body when extraBody is empty string or empty object', async () => {
    const mockCreate = mockSuccessAI();

    await createLLMResponse({
      body: {
        model: 'gpt-4',
        messages,
        stream: false,
        extraBody: ''
      }
    });

    await createLLMResponse({
      body: {
        model: 'gpt-4',
        messages,
        stream: false,
        extraBody: '{}'
      }
    });

    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('extraBody');
    expect(mockCreate.mock.calls[1][0]).not.toHaveProperty('extraBody');
    expect(mockCreate.mock.calls[0][0]).toEqual(mockCreate.mock.calls[1][0]);
  });
});
