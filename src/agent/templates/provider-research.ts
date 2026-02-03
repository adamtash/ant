export const PROVIDER_RESEARCH_PROMPT = `
Research current free or freemium AI API providers that can act as backup LLM endpoints. For each provider, extract:
- Provider name
- Official documentation URL
- Base URL (prefer OpenAI-compatible if available)
- Authentication method (API key / OAuth / none)
- Available chat models
- Rate limits (free tier)
- Pricing tier (free/freemium/trial)
- Reliability notes / reputation

Return STRICT JSON in this shape:
{
  "providers": [
    {
      "id": "backup:provider-id",
      "label": "Provider Name",
      "baseUrl": "https://...",
      "apiKeyEnv": "PROVIDER_API_KEY",
      "modelEnv": "PROVIDER_MODEL",
      "notes": "short notes"
    }
  ]
}

Use only trustworthy sources (official docs, well-known GitHub lists). Do not include any API keys.
`;

