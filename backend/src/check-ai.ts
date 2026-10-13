import 'dotenv/config';
import { configuredResponder, formatOpenAICheckFailure } from './openai-chat.js';

try {
  const respond = configuredResponder();
  if (!respond) {
    console.error('OpenAI check not run: configure LUMORA_OPENAI_API_KEY securely, then retry.');
    process.exitCode = 1;
  } else {
    await respond([{ role: 'user', content: 'Suggest one small, realistic productivity habit in one sentence.' }]);
    console.log('OpenAI connection verified: received a complete, non-empty reply. This used one billable API request.');
  }
} catch (error) {
  console.error(formatOpenAICheckFailure(error));
  process.exitCode = 1;
}
