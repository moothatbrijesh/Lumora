import 'dotenv/config';
import { configuredResponder } from './openai-chat.js';

const respond = configuredResponder();
if (!respond) {
  console.error('OpenAI check not run: configure LUMORA_OPENAI_API_KEY securely, then retry.');
  process.exitCode = 1;
} else {
  try {
    await respond([{ role: 'user', content: 'Suggest one small, realistic productivity habit in one sentence.' }]);
    console.log('OpenAI connection verified: received a complete, non-empty reply. This used one billable API request.');
  } catch {
    console.error('OpenAI check failed. Check the API key, Responses API permission, model access, billing, and network settings. No credential values were printed.');
    process.exitCode = 1;
  }
}
