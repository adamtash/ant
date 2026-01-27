export type OpenAIMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
};

export type OpenAIToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type OpenAIToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ChatCompletionResponse = {
  message: OpenAIMessage;
};

export type EmbeddingResponse = {
  embeddings: number[][];
};

export class OpenAIClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(params: { baseUrl: string; apiKey?: string }) {
    this.baseUrl = params.baseUrl.replace(/\/$/, "");
    this.apiKey = params.apiKey;
  }

  async chat(params: {
    model: string;
    messages: OpenAIMessage[];
    tools?: OpenAIToolDefinition[];
    toolChoice?: "auto" | "none";
    temperature?: number;
  }): Promise<ChatCompletionResponse> {
    const payload: Record<string, unknown> = {
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.2,
    };
    if (params.tools && params.tools.length > 0) {
      payload.tools = params.tools;
      payload.tool_choice = params.toolChoice ?? "auto";
    }
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`chat completion failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message: OpenAIMessage }>;
    };
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("chat completion missing message");
    return { message };
  }

  async embed(params: { model: string; input: string[] }): Promise<EmbeddingResponse> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model: params.model, input: params.input }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`embedding failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    const embeddings = data.data?.map((entry) => entry.embedding) ?? [];
    return { embeddings };
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    return headers;
  }
}
