import 'dotenv/config';
import { configuredResponder, formatAICheckFailure, providerKeyName, providerName, selectedProvider } from './ai-provider.js';
import type { AIProvider } from './ai-types.js';

let provider: AIProvider | undefined;
try {
  provider = selectedProvider();
  const respond = configuredResponder(provider);
  if (!respond) {
    console.error(`${providerName(provider)} check not run: configure ${providerKeyName(provider)} securely, then retry.`);
    process.exitCode = 1;
  } else {
    await respond([{ role: 'user', content: 'Suggest one small, realistic productivity habit in one sentence.' }]);
    console.log(`${providerName(provider)} connection verified: received a complete, non-empty reply. This used one API request; free quota or charges depend on your project and model.`);
  }
} catch (error) {
  console.error(formatAICheckFailure(error, provider));
  process.exitCode = 1;
}
